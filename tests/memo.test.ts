// Unit tests for the voice-command grammar plumbing and approval-gate state
// (spec §5–7) — pure functions and the state store, no network, no LLM.

import { describe, expect, it } from 'vitest'
import { buildReplyMime } from '../src/connectors/gmail.js'
import { staleDraftFlags } from '../src/pipelines/digest.js'
import {
  buildDraftPost,
  extractRiskyNumbers,
  validateDraft,
  type DraftRequest,
  type GeneratedDraft,
} from '../src/pipelines/draft.js'
import {
  addBusinessDays,
  buildMemoSystemPrompt,
  lastWinsPerItem,
  parseActions,
  type MemoAction,
} from '../src/pipelines/memo.js'
import { StateStore, type DraftRecord } from '../src/state.js'
import { CLASSIFY_FIXTURES } from './fixtures/synthetic-emails.js'

function action(partial: Partial<MemoAction>): MemoAction {
  return {
    verb: 'reply',
    itemNumber: 1,
    content: '',
    delegateTo: null,
    snoozeUntil: null,
    question: null,
    ...partial,
  }
}

describe('parseActions', () => {
  it('parses a well-formed action list', () => {
    const actions = parseActions(
      `{"actions": [
        {"verb": "reply", "item_number": 3, "content": "yes, scope confirmed", "delegate_to": null, "snooze_until": null, "question": null},
        {"verb": "snooze", "item_number": 5, "content": "", "delegate_to": null, "snooze_until": "2026-08-14", "question": null}
      ]}`,
    )
    expect(actions).toHaveLength(2)
    expect(actions[0]).toMatchObject({ verb: 'reply', itemNumber: 3 })
    expect(actions[1]).toMatchObject({ verb: 'snooze', snoozeUntil: '2026-08-14' })
  })

  it('drops unknown verbs and survives garbage', () => {
    expect(
      parseActions('{"actions": [{"verb": "send", "item_number": 1}]}'),
    ).toHaveLength(0)
    expect(parseActions('sure, sounds good!')).toHaveLength(0)
  })

  it('parses the approve verb (voice approval — same gate as the ✅ reaction)', () => {
    const actions = parseActions(
      '{"actions": [{"verb": "approve", "item_number": 2, "content": "", "delegate_to": null, "snooze_until": null, "question": null}]}',
    )
    expect(actions).toEqual([
      expect.objectContaining({ verb: 'approve', itemNumber: 2 }),
    ])
  })
})

describe('lastWinsPerItem (spec §5: later instruction wins per item)', () => {
  it('keeps only the later action per item, preserving unnumbered ones', () => {
    const result = lastWinsPerItem([
      action({ itemNumber: 2, verb: 'reply', content: 'first take' }),
      action({ itemNumber: null, verb: 'clarify', question: 'which one?' }),
      action({ itemNumber: 2, verb: 'archive', content: '' }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find((a) => a.itemNumber === 2)).toMatchObject({ verb: 'archive' })
  })
})

describe('addBusinessDays', () => {
  it('skips weekends (Thu + 3 → Tue)', () => {
    const thursday = new Date('2026-08-06T12:00:00Z')
    expect(addBusinessDays(thursday, 3).toISOString().slice(0, 10)).toBe('2026-08-11')
  })
})

describe('buildMemoSystemPrompt', () => {
  it('loads ARYA.md first and lists the digest items with draft status', () => {
    const prompt = buildMemoSystemPrompt(
      { arya: 'ARYA-CONTENT', labelTaxonomy: 'TAX', triageRules: 'RULES' },
      [
        { number: 1, line: 'Luis / Outlier — slate scope', section: 'needs_you', threadId: 't1', draftStatus: 'pending' },
      ],
      new Date('2026-08-09T12:00:00Z'),
    )
    expect(prompt.indexOf('ARYA-CONTENT')).toBe(0)
    expect(prompt).toContain('1) [thread t1] [draft: pending] (needs_you) Luis / Outlier — slate scope')
    expect(prompt).toContain('AMBIGUITY RULE')
  })
})

describe('numbers-rule backstop (CLAUDE.md constraint 5)', () => {
  const thread = CLASSIFY_FIXTURES[0]!.thread

  function requestWith(instruction: string): DraftRequest {
    return { kind: 'reply', thread, instruction }
  }

  function draftWith(body: string): GeneratedDraft {
    return {
      to: 'luis@outlierpicks.example.com',
      cc: '',
      subject: 'Re: September slate scope',
      body,
      headerLine: 'To Luis (Outlier) — Re: September slate scope',
    }
  }

  it('extracts dollar figures, percentages, and k/m shorthand', () => {
    expect(
      extractRiskyNumbers('rate is $12,500 or 15% rev share, budget 50k'),
    ).toEqual(['$12,500', '15%', '50k'])
  })

  it('flags a number Zaire never said', () => {
    const warnings = validateDraft(
      draftWith('Confirmed — the budget is $25,000 as discussed.'),
      requestWith('tell him the scope is confirmed'),
    )
    expect(warnings.some((w) => w.includes('$25,000'))).toBe(true)
  })

  it('allows numbers Zaire explicitly said, regardless of formatting', () => {
    const warnings = validateDraft(
      draftWith('Confirmed at $25,000 for September.'),
      requestWith('tell Luis yes, 25000 dollars, confirmed... wait, $25,000 I mean'),
    )
    expect(warnings).toHaveLength(0)
  })

  it('accepts the [ZW: confirm number] placeholder as the safe path', () => {
    const warnings = validateDraft(
      draftWith('On budget: [ZW: confirm number] — will lock that with you directly.'),
      requestWith('acknowledge the budget question, I need to check the number'),
    )
    expect(warnings).toHaveLength(0)
  })

  it('flags a reply recipient who is not in the thread', () => {
    const warnings = validateDraft(
      { ...draftWith('Confirmed.'), to: 'stranger@elsewhere.example.com' },
      requestWith('confirm it'),
    )
    expect(warnings.some((w) => w.includes('stranger@elsewhere.example.com'))).toBe(true)
  })
})

describe('buildDraftPost (spec §6–7)', () => {
  it('puts the header line first and surfaces warnings loudly', () => {
    const post = buildDraftPost(
      {
        to: 'luis@outlierpicks.example.com',
        cc: '',
        subject: 'Re: Slate',
        body: 'Confirmed.',
        headerLine: 'To Luis (Outlier) — Re: Slate',
      },
      ['contains a number Zaire didn\'t say: "$25,000" — hard rule 3'],
    )
    const lines = post.split('\n')
    expect(lines[0]).toBe('*To Luis (Outlier) — Re: Slate*')
    expect(post).toContain(':warning: contains a number')
    expect(post).toContain('React ✅ or say "approve #"')
  })
})

describe('buildReplyMime', () => {
  it('builds a threaded RFC 2822 reply that round-trips', () => {
    const raw = buildReplyMime({
      to: 'luis@outlierpicks.example.com',
      cc: 'anna@xclsvmedia.com',
      subject: 'Re: September slate scope',
      body: 'Confirmed — same scope as August.',
      inReplyTo: '<abc123@mail.example.com>',
    })
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    expect(decoded).toContain('To: luis@outlierpicks.example.com')
    expect(decoded).toContain('Cc: anna@xclsvmedia.com')
    expect(decoded).toContain('Subject: Re: September slate scope')
    expect(decoded).toContain('In-Reply-To: <abc123@mail.example.com>')
    expect(decoded).toContain('References: <abc123@mail.example.com>')
    expect(decoded.endsWith('Confirmed — same scope as August.')).toBe(true)
  })
})

describe('draft state machine (spec §7)', () => {
  function seedDraft(store: StateStore, overrides: Partial<Parameters<StateStore['createDraft']>[0]> = {}) {
    return store.createDraft({
      threadId: 't1',
      kind: 'reply',
      status: 'pending',
      body: 'Confirmed.',
      toAddr: 'luis@outlierpicks.example.com',
      ccAddr: null,
      subject: 'Re: Slate',
      headerLine: 'To Luis (Outlier) — Re: Slate',
      instruction: 'confirm it',
      channel: 'C1',
      slackTs: '100.1',
      digestSlackTs: '100.0',
      itemNumber: 1,
      ...overrides,
    })
  }

  it('creates pending, supersedes on revision, approves on ✅', () => {
    const store = new StateStore(':memory:')
    const first = seedDraft(store)
    store.setDraftStatus(first, 'superseded')
    const second = seedDraft(store, { body: 'Confirmed — revised.', slackTs: '100.2' })
    store.setDraftStatus(second, 'approved')
    expect(store.draftsByStatus('pending')).toHaveLength(0)
    expect(store.draftsForThread('t1').map((d) => d.status)).toEqual([
      'superseded',
      'approved',
    ])
    store.close()
  })

  it('tracks the Slack idempotency ledger', () => {
    const store = new StateStore(':memory:')
    expect(store.isHandled('200.1')).toBe(false)
    store.markHandled('200.1')
    store.markHandled('200.1') // idempotent
    expect(store.isHandled('200.1')).toBe(true)
    store.close()
  })
})

describe('staleDraftFlags (spec §7.4)', () => {
  const NOW = new Date('2026-08-09T12:00:00Z')

  function pendingDraft(createdAt: string): DraftRecord {
    return {
      id: 1,
      threadId: 't1',
      kind: 'reply',
      status: 'pending',
      body: 'x',
      toAddr: null,
      ccAddr: null,
      subject: 'Re: Slate',
      headerLine: 'To Luis (Outlier) — Re: Slate',
      instruction: null,
      channel: null,
      slackTs: null,
      digestSlackTs: null,
      itemNumber: null,
      createdAt,
      updatedAt: createdAt,
    }
  }

  it('flags drafts pending past 24h, leaves fresh ones alone', () => {
    const flags = staleDraftFlags(
      [pendingDraft('2026-08-08T10:00:00Z'), pendingDraft('2026-08-09T09:00:00Z')],
      NOW,
    )
    expect(flags).toEqual(['Draft unapproved 24h+: To Luis (Outlier) — Re: Slate'])
  })
})
