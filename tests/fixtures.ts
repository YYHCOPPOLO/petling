import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { TestContext } from 'node:test'

export function fixture(context: TestContext): string {
  const root = resolve('.verification/unit')
  mkdirSync(root, { recursive: true })
  const directory = mkdtempSync(join(root, 'case-'))
  context.after(() => {
    assert.ok(resolve(directory).startsWith(root + sep))
    rmSync(directory, { recursive: true, force: true })
  })
  return directory
}
