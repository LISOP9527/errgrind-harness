/** Persisted Session recovery across two real dsh server processes on the same port. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { REPO_ROOT, newEnglishPage, saveFailureShot, writeComposerDraft } from './support.ts'

class RestartableServer {
  private child: ChildProcess | undefined
  private closed: Promise<void> | undefined
  private output = ''
  readonly startupBlocked = Promise.withResolvers<undefined>()

  constructor(private readonly world: string, private readonly modelUrl: string) {}

  async start(port: number, holdStartup = false, extraPatches: readonly string[] = []): Promise<string> {
    if (this.child !== undefined) throw new Error('Server is already running')
    this.output = ''
    const ready = Promise.withResolvers<string>()
    const child = spawn(process.execPath, [
      join(REPO_ROOT, 'apps/cli/lib/bin.js'), '--profile', 'web',
      '--patch', fileURLToPath(new URL('./pin-browse-picker.overlay.yml', import.meta.url)),
      '--patch', fileURLToPath(new URL('./fixtures/restart-startup.overlay.yml', import.meta.url)),
      ...extraPatches.flatMap(path => ['--patch', path]),
      '--no-open', '--port', String(port),
    ], {
      cwd: this.world,
      env: {
        ...process.env, NODE_OPTIONS: '',
        DSH_HOME: join(this.world, 'home'), DSH_AGENTS_HOME: join(this.world, 'agents'),
        DSH_TELEMETRY_DISABLED: '1', DEEPSEEK_API_KEY: 'keyless-server-restart-fixture',
        DEEPSEEK_BASE_URL: this.modelUrl,
        DSH_WEB_RESTART_HOLD_STARTUP: holdStartup ? '1' : '0',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    this.child = child
    const receive = (data: Buffer): void => {
      this.output += data.toString()
      const url = /dsh web: (http:\/\/[^\s]+)/u.exec(this.output)?.[1]
      if (url !== undefined) ready.resolve(url)
    }
    child.stdout?.on('data', receive)
    child.stderr?.on('data', receive)
    child.on('message', (message) => {
      if (message === 'startup-blocked') this.startupBlocked.resolve(undefined)
    })
    child.once('error', (error) => { ready.reject(error) })
    this.closed = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        ready.reject(new Error('Server exited before readiness: ' + JSON.stringify({ code, signal }) + '\n' + this.logs()))
        resolve()
      })
    })
    const timer = setTimeout(() => { ready.reject(new Error('Server readiness timed out\n' + this.logs())) }, 30_000)
    try { return await ready.promise }
    finally { clearTimeout(timer) }
  }

  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.resumeStartup()
    let forced = false
    const timer = setTimeout(() => { forced = true; child.kill('SIGKILL') }, 15_000)
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await this.closed
    } finally {
      clearTimeout(timer)
      this.child = undefined
    }
    if (forced) throw new Error('Server did not stop after SIGTERM\n' + this.logs())
  }

  resumeStartup(): void {
    if (this.child?.connected) this.child.send('resume-startup')
  }

  logs(): string { return this.output.replace(/([?&]token=)[A-Za-z0-9_-]+/gu, '$1<redacted>') }
}

it.each([false, true])('keeps the same revision, Session and page across a server restart (delayed startup: %s)', async (holdStartup) => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-server-restart-'))
  onTestFinished(() => rm(world, { recursive: true, force: true }))
  const model = createServer((request, response) => {
    request.resume()
    request.once('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: 'restart-fixture', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Persisted server restart fixture.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      response.end(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''))
    })
  })
  onTestFinished(() => new Promise<void>((resolve, reject) => {
    model.close((error) => { if (error) reject(error); else resolve() })
    model.closeAllConnections()
  }))
  await new Promise<void>((resolve, reject) => {
    model.once('error', reject)
    model.listen(0, '127.0.0.1', resolve)
  })
  const modelAddress = model.address()
  if (modelAddress === null || typeof modelAddress === 'string') throw new Error('Model fixture did not listen')
  const server = new RestartableServer(world, `http://127.0.0.1:${String(modelAddress.port)}`)
  onTestFinished(() => server.stop())
  const workspacePath = join(world, 'workspace')
  await mkdir(workspacePath)

  const url = await server.start(0)
  const port = Number(new URL(url).port)
  const authenticated = await fetch(url, { redirect: 'manual' })
  const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0]
  if (cookie === undefined) throw new Error('Server did not issue an authentication cookie')
  const rpc = async <T>(endpoint: string, args: object): Promise<T> => {
    const response = await fetch(new URL('/api/' + endpoint, url), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } }),
    })
    const result = await response.json() as { result: { ok: boolean; value: T; error?: { message: string } } }
    if (!result.result.ok) throw new Error(`${endpoint}: ${String(result.result.error?.message)}`)
    return result.result.value
  }
  await rpc('workspace/create', { request: { path: workspacePath } })
  const scenarioId = randomUUID()

  const browser = await chromium.launch({ headless: true })
  onTestFinished(() => browser.close())
  const page = await newEnglishPage(browser)
  const errors: string[] = []
  const streamErrors: unknown[] = []
  const graphs: { rev: string; entries: { id: string; rev: string }[] }[] = []
  let readyFrames = 0
  let sessionBaselines = 0
  let navigations = 0
  page.on('pageerror', (error) => { errors.push(String(error)) })
  page.on('websocket', (socket) => {
    const endpoints = new Map<string, string>()
    socket.on('framesent', ({ payload }) => {
      if (typeof payload !== 'string') return
      const frame = JSON.parse(payload) as { type?: string; streamId: string; endpoint: string }
      if (frame.type === 'open') endpoints.set(frame.streamId, frame.endpoint)
    })
    socket.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string') return
      const message = JSON.parse(payload) as { type?: string; streamId: string; value?: { type?: string }; error?: unknown }
      if (message.type === 'error') streamErrors.push(message.error)
      if (message.type === 'item' && message.value?.type === 'ready') readyFrames++
      if (message.type === 'item' && endpoints.get(message.streamId) === 'session/follow'
        && message.value?.type === 'snapshot') sessionBaselines++
    })
  })
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  network.on('Network.eventSourceMessageReceived', (event) => {
    const message = JSON.parse(event.data) as { type?: string; graph: typeof graphs[number] }
    if (message.type === 'graph') graphs.push(message.graph)
  })
  onTestFailed(async () => {
    await saveFailureShot(page, 'web-server-restart-' + scenarioId)
    await writeFile(join(REPO_ROOT, '.artifacts', 'server-restart-' + scenarioId + '.json'), JSON.stringify({ errors, streamErrors, graphs, server: server.logs() }, null, 2))
  })
  await page.goto(url, { waitUntil: 'load' })
  await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 20_000 })
  const notice = page.getByRole('button', { name: 'Continue', exact: true })
  await notice.click({ timeout: 15_000 })
  const composer = page.locator('[data-composer-input][contenteditable="true"]')
  await writeComposerDraft(page, composer, 'Create a completed turn for the server restart test.')
  await composer.press('Enter')
  const response = page.getByRole('paragraph').filter({ hasText: /^Persisted server restart fixture\.$/u })
  await response.last().waitFor({ timeout: 20_000 })
  const draft = 'Unsent draft across a server restart'
  await writeComposerDraft(page, composer, draft)
  await expect.poll(() => graphs.length).toBeGreaterThan(0)
  await expect.poll(() => sessionBaselines).toBeGreaterThan(0)
  const originalRoot = await page.locator('[data-slot="root"]').elementHandle()
  expect(originalRoot).not.toBeNull()
  const beforeReady = readyFrames
  const beforeBaseline = sessionBaselines
  const beforeGraphs = graphs.length
  page.on('framenavigated', () => { navigations++ })

  await server.stop()
  let restarted: string
  const restarting = server.start(port, holdStartup)
  try {
    if (holdStartup) {
      await Promise.race([
        server.startupBlocked.promise,
        restarting.then(() => { throw new Error('the restarted Host did not hold controller startup') }),
      ])
      const opened = await page.evaluate(() => new Promise<boolean>((resolve) => {
        const endpoint = new URL('api/remote.mux', location.href)
        endpoint.protocol = 'ws:'
        const socket = new WebSocket(endpoint)
        let accepted = false
        socket.addEventListener('open', () => { accepted = true; socket.close() })
        socket.addEventListener('close', () => { resolve(accepted) })
      }))
      expect(opened).toBe(false)
      expect(readyFrames).toBe(beforeReady)
    }
  } finally {
    server.resumeStartup()
    restarted = await restarting
  }
  expect(new URL(restarted).origin).toBe(new URL(url).origin)
  await expect.poll(() => readyFrames, { timeout: 30_000 }).toBeGreaterThan(beforeReady)
  await expect.poll(() => sessionBaselines, { timeout: 30_000 }).toBeGreaterThan(beforeBaseline)
  await expect.poll(() => graphs.length, { timeout: 30_000 }).toBeGreaterThan(beforeGraphs)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { resolve() }) })
  }))

  expect(errors).toEqual([])
  expect(streamErrors).toEqual([])
  for (const graph of graphs.slice(beforeGraphs)) expect(graph).toEqual(graphs[beforeGraphs - 1])
  expect(await originalRoot!.evaluate(element => element.isConnected)).toBe(true)
  expect(await composer.textContent()).toBe(draft)
  expect(await response.isVisible()).toBe(true)

  await composer.press('Enter')
  await expect.poll(() => response.count(), { timeout: 20_000 }).toBe(2)
  expect(errors).toEqual([])
  expect(streamErrors).toEqual([])
  expect(navigations).toBe(0)
})

it('restores ErrGrind image receipt and Session after a real Host restart', async () => {
  const world = await mkdtemp(join(tmpdir(), 'dsh-errgrind-restart-'))
  const model = createServer((request, response) => {
    request.resume()
    request.once('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const events = [
        { type: 'message_start', message: { id: 'errgrind-restart-fixture', model: 'mock-model', usage: { input_tokens: 3, output_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'The submitted math error is ready for review.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
        { type: 'message_stop' },
      ]
      response.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    })
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let server: RestartableServer | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      model.once('error', reject)
      model.listen(0, '127.0.0.1', resolve)
    })
    const modelAddress = model.address()
    if (modelAddress === null || typeof modelAddress === 'string') throw new Error('Model fixture did not listen')
    const modelUrl = `http://127.0.0.1:${String(modelAddress.port)}`
    server = new RestartableServer(world, modelUrl)
    const errgrindPatch = join(REPO_ROOT, 'errgrind-fork/web.patch.yml')
    const prompt = 'I wrote 2 + 3 = 6. Please record this math error for review.'
    let url = await server.start(0, false, [errgrindPatch])
    const port = Number(new URL(url).port)
    await mkdir(join(world, 'workspace'))
    const authenticated = await fetch(url, { redirect: 'manual' })
    const cookie = authenticated.headers.get('set-cookie')?.split(';', 1)[0]
    if (cookie === undefined) throw new Error('Server did not issue an authentication cookie')
    const listSessions = async (): Promise<{ sessionId: string; blank: boolean }[]> => {
      const response = await fetch(new URL('/api/session/list', url), {
        method: 'POST', headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'session/list',
          payload: { args: { _request: {} } } }),
      })
      const envelope = await response.json() as {
        result: { ok: boolean; value?: { items: { sessionId: string; blank: boolean }[] } }
      }
      if (!response.ok || !envelope.result.ok || envelope.result.value === undefined) {
        throw new Error('Could not list persisted Sessions')
      }
      return envelope.result.value.items
    }
    const createWorkspace = await fetch(new URL('/api/workspace/create', url), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: 'workspace/create',
        payload: { args: { request: { path: join(world, 'workspace') } } } }),
    })
    expect(createWorkspace.ok).toBe(true)

    browser = await chromium.launch({ headless: true })
    const page = await newEnglishPage(browser)
    await page.goto(url, { waitUntil: 'load' })
    await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 20_000 })
    await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 15_000 })

    const composer = page.locator('[data-composer-input][contenteditable="true"]')
    const modelTrigger = page.getByRole('button', { name: /^Select model, current/ })
    await expect.poll(() => modelTrigger.getAttribute('aria-label'), { timeout: 10_000 })
      .toContain('DeepSeek-V41-Flash')

    const imageBytes = await readFile(fileURLToPath(new URL('../../../snapshots/session/read-image/workspace/red.png', import.meta.url)))
    const imageDigest = createHash('sha256').update(imageBytes).digest('hex')
    const imageName = 'synthetic-math-error.png'
    const image = page.getByRole('img', { name: imageName, exact: true })
    await page.locator('input[type="file"]').setInputFiles({ name: imageName, mimeType: 'image/png', buffer: imageBytes })
    await image.waitFor({ timeout: 15_000 })
    await writeComposerDraft(page, composer, prompt)
    const accepted = page.waitForResponse(response => response.url().endsWith('/api/session/prompt'))
    await page.getByRole('button', { name: 'Send message' }).click()
    const admission = await accepted
    expect(admission.ok()).toBe(true)
    const envelope = await admission.json() as { result?: { ok?: boolean; value?: { accepted?: boolean } } }
    expect(envelope.result?.ok).toBe(true)
    expect(envelope.result?.value?.accepted).toBe(true)
    const response = page.getByRole('paragraph').filter({ hasText: /^The submitted math error is ready for review\.$/u })
    await response.waitFor({ timeout: 20_000 })

    const originalSession = (await listSessions()).find(session => !session.blank)
    if (originalSession === undefined) throw new Error('Prompted Session was not listed')

    const receipt = `synthetic-math-error.png: ${imageDigest.slice(0, 8)}... (${imageBytes.byteLength}B)`
    await writeComposerDraft(page, composer, '/error-status')
    await composer.press('Enter')
    await page.getByText(receipt, { exact: false }).waitFor({ timeout: 15_000 })
    await expect.poll(async () => (await page.locator('body').innerText())
      .includes(`原始输入: ${prompt.length} 字`), { timeout: 10_000 }).toBe(true)

    await server.stop()
    url = await server.start(port, false, [errgrindPatch])
    await page.goto(url, { waitUntil: 'load' })
    await page.locator('[data-slot="root"]').waitFor({ state: 'attached', timeout: 20_000 })
    const restoredSessions = await listSessions()
    expect(restoredSessions.some(session => session.sessionId === originalSession.sessionId)).toBe(true)
    const sessionRow = page.locator(`[data-row-key="session:${originalSession.sessionId}"]`)
    await sessionRow.waitFor({ timeout: 15_000 })
    await sessionRow.click()
    await expect.poll(() => sessionRow.getAttribute('aria-selected'), { timeout: 10_000 }).toBe('true')
    await expect.poll(async () => (await page.locator('body').innerText()).includes(prompt),
      { timeout: 20_000 }).toBe(true)
    const restoredImage = page.getByRole('img', { name: imageName, exact: true })
    await restoredImage.waitFor({ timeout: 20_000 })
    await expect.poll(() => restoredImage.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
      .toBe(true)
    const restoredComposer = page.locator('[data-composer-input][contenteditable="true"]')
    await writeComposerDraft(page, restoredComposer, '/error-status')
    await restoredComposer.press('Enter')
    await page.getByText(receipt, { exact: false }).last().waitFor({ timeout: 15_000 })
  } finally {
    await server?.stop()
    await browser?.close()
    await new Promise<void>((resolve) => {
      model.close(() => { resolve() })
      model.closeAllConnections()
    })
    await rm(world, { recursive: true, force: true })
  }
}, 180_000)
