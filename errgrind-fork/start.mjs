/** Launch the ErrGrind composition through the supported DSH profile entry. */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'

const forkRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = dirname(forkRoot)
const require = createRequire(join(repositoryRoot, 'package.json'))
const productHome = resolve(process.env.ERRGRIND_HOME?.trim() || join(homedir(), '.errgrind'))
const webIndex = join(repositoryRoot, 'apps/web/dist/index.html')
if (!existsSync(webIndex) || !readFileSync(webIndex, 'utf8').includes('/errgrind-manifest.webmanifest')) {
  console.warn('当前 Web 构建尚未使用 ErrGrind 品牌；运行 corepack pnpm run errgrind:build 后重启。')
}
const args = process.argv.slice(2)
if (args.some(arg => arg === '--profile' || arg.startsWith('--profile='))) {
  throw new Error('ErrGrind 使用固定的 Web 配置；请不要传入 --profile。')
}

const child = spawn(process.execPath, [
  '--import', require.resolve('tsx/esm'),
  join(repositoryRoot, 'apps/cli/src/bin.ts'),
  '--profile', 'web', '--patch', join(forkRoot, 'web.patch.yml'), ...args,
], {
  cwd: repositoryRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    DSH_HOME: productHome,
    ERRGRIND_PROMPT_PATH: process.env.ERRGRIND_PROMPT_PATH || join(forkRoot, 'prompts/system.md'),
    ERRGRIND_TOOL_PROMPTS_PATH: process.env.ERRGRIND_TOOL_PROMPTS_PATH || join(forkRoot, 'prompts/tools.json'),
  },
})

const forwardInterrupt = () => { child.kill('SIGINT') }
const forwardTerminate = () => { child.kill('SIGTERM') }
process.on('SIGINT', forwardInterrupt)
process.on('SIGTERM', forwardTerminate)
child.once('error', (error) => {
  console.error(`ErrGrind 启动失败：${error.message}`)
  process.exitCode = 1
})
child.once('exit', (code, signal) => {
  process.off('SIGINT', forwardInterrupt)
  process.off('SIGTERM', forwardTerminate)
  process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143)
})
