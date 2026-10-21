import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { installerNames, releaseManifest, releasePolicy } from '../scripts/release'
import { fixture } from './fixtures'

test('release tags must match both package versions; branch builds never publish', () => {
  assert.equal(releasePolicy('0.1.0', '0.1.0', '0.1.0', 'refs/heads/main').release, false)
  assert.equal(releasePolicy('0.1.0', '0.1.0', '0.1.0', 'refs/tags/v0.1.0').release, true)
  assert.equal(releasePolicy('0.2.0-beta.1', '0.2.0-beta.1', '0.2.0-beta.1', 'refs/tags/v0.2.0-beta.1').prerelease, true)
  assert.throws(() => releasePolicy('0.1.0', '0.1.0', '0.1.0', 'refs/tags/v1.0.0'), /发布标签/)
  assert.throws(() => releasePolicy('0.1.0', '0.0.1', '0.1.0', 'refs/tags/v0.1.0'), /版本不一致/)
  assert.throws(() => releasePolicy('1.0.0-beta.01', '1.0.0-beta.01', '1.0.0-beta.01', ''), /语义版本/)
})

test('release manifest refuses missing installers and records SHA256 for the complete matrix', async context => {
  const directory = fixture(context)
  const version = '0.1.0'
  const commit = 'a'.repeat(40)
  writeFileSync(join(directory, installerNames(version)[0]), 'test installer')
  await assert.rejects(releaseManifest(directory, version, commit), /不完整/)
  for (const name of installerNames(version)) writeFileSync(join(directory, name), name)
  const manifest = await releaseManifest(directory, version, commit)
  assert.equal(manifest.assets.length, 5)
  assert.equal(manifest.commit, commit)
  const sums = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8')
  for (const asset of manifest.assets) {
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    assert.ok(sums.includes(`${asset.sha256}  ${asset.name}`))
  }
  writeFileSync(join(directory, 'unexpected.exe'), 'wrong version')
  await assert.rejects(releaseManifest(directory, version, commit), /版本不匹配/)
})
