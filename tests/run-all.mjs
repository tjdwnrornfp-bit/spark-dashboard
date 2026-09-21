import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
const { scripts } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
for (const name of Object.keys(scripts).filter((name) => name.startsWith('test:'))) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status || 1)
}
console.log('PASS: all regression suites')
