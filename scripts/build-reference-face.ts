/** Build package references and bundles without loading a root test aggregate. */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import ts from 'typescript'
import { pnpmInvocation } from './pnpm-invocation.ts'

const root = resolve(import.meta.dirname, '..')
const face = process.argv[2]
if (face !== 'host' && face !== 'client') {
  throw new Error('build-reference-face: expected host or client')
}

const configPath = resolve(root, `tsconfig.${face}.json`)
const loaded = ts.readConfigFile(configPath, path => ts.sys.readFile(path))
if (loaded.error !== undefined) {
  throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
}
const configuration: unknown = loaded.config
const referenceEntries = typeof configuration === 'object' && configuration !== null
  ? (configuration as { references?: unknown }).references
  : undefined
if (!Array.isArray(referenceEntries) || referenceEntries.length === 0
  || !referenceEntries.every((entry: unknown) => typeof entry === 'object'
    && entry !== null && 'path' in entry && typeof entry.path === 'string')) {
  throw new Error(`build-reference-face: ${configPath} has no project references`)
}
const references = (referenceEntries as Array<{ path: string }>).map(ref => ref.path)

// Vite builds the Web application separately. Its root TS project currently
// reports TS2878; package projects remain checked here while that is resolved.
const projects = face === 'client' ? references.filter(path => path !== './apps/web') : references
if (face === 'client' && projects.length !== references.length - 1) {
  throw new Error('build-reference-face: expected exactly one ./apps/web reference')
}

function run(command: string, args: string[], environment = process.env): void {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build-reference-face: ${command} exited with ${String(result.status ?? result.signal)}`)
  }
}

console.log(`build-reference-face: checking ${String(projects.length)} ${face} reference projects`)
run(process.execPath, [
  '--max-old-space-size=1536',
  resolve(root, 'node_modules/typescript/bin/tsc'),
  '-b',
  ...projects,
  '--pretty',
  'false',
])

console.log(`build-reference-face: bundling ${face} artifacts`)
const bundleEnvironment = {
  ...process.env,
  NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=1536'].filter(Boolean).join(' '),
}
const invocation = pnpmInvocation(['exec', 'tsdown', `--env.DSH_BUILD_FACE=${face}`, '--log-level', 'error'], bundleEnvironment)
run(invocation.command, invocation.args, bundleEnvironment)
