// Unit tests for corpus exclusions and retrieval (spec §6) — pure, no network.

import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  formatExamples,
  isExcluded,
  parseExclusions,
  retrieveByContact,
  retrieveBySimilarity,
  type CorpusEmail,
} from '../src/retrieval.js'

const EXCLUSIONS_MD = `# corpus-exclusions.md

## Excluded contacts

- legal@
- tony@private.example.com

## Excluded keywords

- term sheet
- salary
- (add more, one per line)
`

let nextId = 0
function email(partial: Partial<CorpusEmail>): CorpusEmail {
  return {
    id: `e${++nextId}`,
    threadId: 't1',
    date: '2026-06-01T00:00:00.000Z',
    to: 'luis@outlierpicks.example.com',
    cc: '',
    subject: 'Slate',
    body: 'Confirmed — same scope as August.',
    ...partial,
  }
}

describe('parseExclusions', () => {
  it('reads both sections, lowercased, ignoring placeholder lines', () => {
    const exclusions = parseExclusions(EXCLUSIONS_MD)
    expect(exclusions.contacts).toEqual(['legal@', 'tony@private.example.com'])
    expect(exclusions.keywords).toEqual(['term sheet', 'salary'])
  })
})

describe('isExcluded (spec §6.1 — excluded material never enters the corpus)', () => {
  const exclusions = parseExclusions(EXCLUSIONS_MD)

  it('excludes by contact fragment in To/Cc, case-insensitively', () => {
    expect(
      isExcluded(email({ to: 'Legal@rebetlegal.example.com' }), exclusions),
    ).toBe(true)
    expect(
      isExcluded(email({ cc: 'Tony <TONY@private.example.com>' }), exclusions),
    ).toBe(true)
  })

  it('excludes by keyword in subject or body', () => {
    expect(isExcluded(email({ subject: 'Revised TERM SHEET' }), exclusions)).toBe(true)
    expect(
      isExcluded(email({ body: 'we can discuss salary bands tomorrow' }), exclusions),
    ).toBe(true)
  })

  it('keeps ordinary partner mail', () => {
    expect(isExcluded(email({}), exclusions)).toBe(false)
  })
})

describe('retrieveByContact (priority 1: exact contact)', () => {
  it('returns the most recent emails to that address, capped at k', () => {
    const corpus = [
      email({ id: 'old', to: 'luis@outlierpicks.example.com', date: '2026-01-01T00:00:00.000Z' }),
      email({ id: 'new', to: 'Luis <luis@outlierpicks.example.com>', date: '2026-07-01T00:00:00.000Z' }),
      email({ id: 'other', to: 'jess@rebet.example.com' }),
      email({ id: 'mid', to: 'luis@outlierpicks.example.com', date: '2026-05-01T00:00:00.000Z' }),
    ]
    const result = retrieveByContact(corpus, ['luis@outlierpicks.example.com'], 2)
    expect(result.map((e) => e.id)).toEqual(['new', 'mid'])
  })

  it('returns nothing for no recipients', () => {
    expect(retrieveByContact([email({})], [])).toEqual([])
  })
})

describe('retrieveBySimilarity (priority 2: same situation type)', () => {
  it('ranks by cosine similarity and skips contact-matched ids', () => {
    const corpus = [
      email({ id: 'a' }),
      email({ id: 'b' }),
      email({ id: 'c' }),
      email({ id: 'no-vector' }),
    ]
    const embeddings = {
      a: [1, 0],
      b: [0.9, 0.1],
      c: [0, 1],
    }
    const result = retrieveBySimilarity(corpus, embeddings, [1, 0], new Set(['a']), 2)
    expect(result.map((e) => e.id)).toEqual(['b', 'c'])
  })

  it('cosineSimilarity behaves', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe('formatExamples (spec §6.2 — style only, never content)', () => {
  it('leads with the style-only framing and separates the two priorities', () => {
    const block = formatExamples(
      [email({ id: 'contact', subject: 'Slate', situation: 'established_partner' })],
      [email({ id: 'similar', subject: 'Kickoff' })],
    )!
    expect(block.startsWith('## Precedent')).toBe(true)
    expect(block).toContain('STYLE ONLY')
    expect(block).toContain('hard rule 3')
    expect(block).toContain('### To this exact contact')
    expect(block).toContain('### Similar situations')
    expect(block.indexOf('To this exact contact')).toBeLessThan(
      block.indexOf('Similar situations'),
    )
  })

  it('returns null when there is nothing to show', () => {
    expect(formatExamples([], [])).toBeNull()
  })
})
