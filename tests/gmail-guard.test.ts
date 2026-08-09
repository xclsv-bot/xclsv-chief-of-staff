// Structural guard for CLAUDE.md constraints 1 and 2: the Gmail connector must
// never grow a send or delete code path. gmail.modify (the narrowest usable
// scope) would technically allow both, so this test is the enforcement layer.
// If it fails, someone added a forbidden capability — remove it, don't relax this.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const connector = readFileSync('src/connectors/gmail.ts', 'utf8')
const authScript = readFileSync('scripts/get_gmail_token.ts', 'utf8')

describe('gmail connector — no send, no delete (spec §2, §9)', () => {
  it.each([
    /messages\s*\.\s*send/,
    /drafts\s*\.\s*send/,
    /\.\s*delete\s*\(/,
    /\.\s*trash\s*\(/,
    /batchDelete/,
  ])('connector contains no forbidden call: %s', (pattern) => {
    expect(connector).not.toMatch(pattern)
  })

  it('auth script requests only the gmail.modify scope', () => {
    const scopes = authScript.match(/https:\/\/www\.googleapis\.com\/auth\/[\w.]+/g) ?? []
    expect(scopes.length).toBeGreaterThan(0)
    for (const scope of scopes) {
      expect(scope).toBe('https://www.googleapis.com/auth/gmail.modify')
    }
  })

  it('auth script never requests a send-capable-only or full-access scope', () => {
    expect(authScript).not.toContain('gmail.send')
    expect(authScript).not.toContain('mail.google.com')
  })
})
