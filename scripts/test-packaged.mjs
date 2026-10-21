import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const executable = process.platform === 'win32' ? 'dist/win-unpacked/AgentPet.exe'
  : process.platform === 'darwin' ? `dist/mac${process.arch === 'arm64' ? '-arm64' : ''}/AgentPet.app/Contents/MacOS/AgentPet` : null
if (!executable || !existsSync(executable)) throw new Error(`未找到当前平台的解包产物：${executable}`)
const child = spawn(process.execPath, ['scripts/desktop-smoke.mjs'], {
  stdio: 'inherit', windowsHide: true,
  env: { ...process.env, AGENT_PET_TEST_EXECUTABLE: resolve(executable), AGENT_PET_TEST_OUTPUT: '.verification/desktop-packaged' },
})
child.on('error', error => { console.error(error); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
