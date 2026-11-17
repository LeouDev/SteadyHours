import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { toCsv, zip } from '../src/lib/files.ts'

describe('export files', () => {
  it('quotes CSV cells that need it and serialises objects as JSON', () => {
    const csv = toCsv([
      { id: 1, name: 'Acme, Ltd', notes: 'Said "hi"\nthen left', counts: { a: 1 }, empty: null },
      { id: 2, name: 'Plain', extra: true },
    ])
    expect(csv).toBe('id,name,notes,counts,empty,extra\r\n1,"Acme, Ltd","Said ""hi""\nthen left","{""a"":1}",,\r\n2,Plain,,,,true\r\n')
  })

  it('writes a ZIP that standard tools read back byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'))
    const files = [{ name: 'clients.csv', text: 'id,name\r\n1,Zürich GmbH\r\n' }, { name: 'empty.csv', text: '' }]
    writeFileSync(join(dir, 'out.zip'), zip(files))
    expect(execFileSync('unzip', ['-t', join(dir, 'out.zip')]).toString()).toMatch(/No errors detected/)
    execFileSync('unzip', ['-q', join(dir, 'out.zip'), '-d', join(dir, 'x')])
    expect(readFileSync(join(dir, 'x', 'clients.csv'), 'utf8')).toBe(files[0].text)
  })
})
