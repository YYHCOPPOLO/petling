import { appendFileSync, createReadStream, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function releasePolicy(version: string, lockVersion: string, rootVersion: string, ref: string) {
  const parsed = SEMVER.exec(version)
  if (!parsed || parsed[4]?.split('.').some(part => /^0\d+$/.test(part))) throw new Error('package.json 必须使用有效的语义版本')
  if (lockVersion !== version || rootVersion !== version) throw new Error('package-lock.json 与 package.json 的版本不一致')
  const release = ref.startsWith('refs/tags/')
  const tag = release ? ref.slice('refs/tags/'.length) : ''
  if (release && tag !== `v${version}`) throw new Error(`发布标签必须为 v${version}，实际为 ${tag}`)
  return { version, release, tag, prerelease: Boolean(parsed[4]) }
}

export const installerNames = (version: string): string[] => [
  `AgentPet-${version}-win-x64.exe`,
  ...['arm64', 'x64'].flatMap(arch => ['dmg', 'zip'].map(extension => `AgentPet-${version}-mac-${arch}.${extension}`)),
].sort()

/** Only a complete set of version-matched installers can become a release. */
export async function releaseManifest(directory: string, version: string, commit: string) {
  if (!SEMVER.test(version) || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('无效发布版本或提交')
  const expected = installerNames(version)
  const files = readdirSync(directory).filter(file => /\.(exe|dmg|zip)$/.test(file)).sort()
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error(`发布安装包不完整或版本不匹配，需要：${expected.join(', ')}`)
  const assets = []
  for (const name of files) {
    const file = join(directory, name)
    const stat = statSync(file)
    if (!stat.isFile() || stat.size === 0) throw new Error(`空安装包：${name}`)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    assets.push({ name, bytes: stat.size, sha256: hash.digest('hex') })
  }
  writeFileSync(join(directory, 'SHA256SUMS.txt'), assets.map(asset => `${asset.sha256}  ${asset.name}`).join('\n') + '\n')
  const manifest = { version, commit, signing: 'Windows unsigned; macOS ad-hoc signed, not notarized', assets }
  writeFileSync(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
  const policy = releasePolicy(pkg.version, lock.version, lock.packages[''].version, process.env.GITHUB_REF ?? '')
  if (process.argv[2] === 'manifest') {
    console.log(await releaseManifest(resolve(process.argv[3] ?? 'release-assets'), policy.version, process.env.GITHUB_SHA ?? ''))
  } else {
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(policy).map(([key, value]) => `${key}=${value}\n`).join(''))
    console.log(policy)
  }
}
