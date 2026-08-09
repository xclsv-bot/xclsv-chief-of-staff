// Unit tests for the deterministic triage layer and plumbing — no network, no LLM.
// The judgment layer is covered by triage.eval.test.ts (opt-in, calls the API).

import { describe, expect, it } from 'vitest'
import { buildLabelChange, GPS_LABELS } from '../src/connectors/gmail.js'
import {
  buildSystemPrompt,
  parseClassification,
  renderThread,
} from '../src/pipelines/classify.js'
import { decideAction } from '../src/pipelines/triage.js'
import { StateStore, type ThreadState } from '../src/state.js'
import {
  ALREADY_PROCESSED_FIXTURE,
  CLASSIFY_FIXTURES,
  INBOUND_ON_WAITING_FIXTURE,
  OUTBOUND_LAST_FIXTURES,
} from './fixtures/synthetic-emails.js'

const OWNER = ['zaire@xclsvmedia.com']

function stateFor(partial: Partial<ThreadState> & { threadId: string }): ThreadState {
  return {
    label: '1-Respond',
    lowConfidence: false,
    needsReading: false,
    waitingSince: null,
    nudgeCount: 0,
    draftStatus: 'none',
    snoozedUntil: null,
    slackRefs: null,
    lastMessageId: null,
    subject: null,
    reason: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  }
}

describe('decideAction — deterministic triage', () => {
  it.each(OUTBOUND_LAST_FIXTURES.map((f) => [f.id, f] as const))(
    'outbound-last → 3-Waiting (%s)',
    (_id, fixture) => {
      const decision = decideAction({ thread: fixture.thread, ownerEmails: OWNER })
      expect(decision).toMatchObject({ type: 'waiting' })
    },
  )

  it('cancels a pending draft when Zaire replied directly in Gmail (spec §10)', () => {
    const fixture = OUTBOUND_LAST_FIXTURES.find((f) => f.tags.includes('cancel-draft'))!
    const decision = decideAction({
      state: stateFor({ threadId: fixture.thread.id, draftStatus: 'pending' }),
      thread: fixture.thread,
      ownerEmails: OWNER,
    })
    expect(decision).toMatchObject({ type: 'waiting', cancelDraft: true })
  })

  it('inbound reply on 3-Waiting → reclassify (1-Respond/2-Review only) + nudge reset', () => {
    const decision = decideAction({
      state: stateFor({
        threadId: INBOUND_ON_WAITING_FIXTURE.thread.id,
        label: '3-Waiting',
        nudgeCount: 2,
        lastMessageId: INBOUND_ON_WAITING_FIXTURE.thread.messages[0]!.id,
      }),
      thread: INBOUND_ON_WAITING_FIXTURE.thread,
      ownerEmails: OWNER,
    })
    expect(decision).toEqual({
      type: 'classify',
      allowed: ['1-Respond', '2-Review'],
      resetNudges: true,
    })
  })

  it('skips a thread whose newest message was already triaged (idempotency)', () => {
    const thread = ALREADY_PROCESSED_FIXTURE.thread
    const decision = decideAction({
      state: stateFor({
        threadId: thread.id,
        label: '2-Review',
        lastMessageId: thread.messages[thread.messages.length - 1]!.id,
      }),
      thread,
      ownerEmails: OWNER,
    })
    expect(decision).toMatchObject({ type: 'skip' })
  })

  it('classifies a brand-new inbound thread', () => {
    const decision = decideAction({
      thread: CLASSIFY_FIXTURES[0]!.thread,
      ownerEmails: OWNER,
    })
    expect(decision).toEqual({ type: 'classify', resetNudges: false })
  })
})

describe('buildLabelChange — mutual exclusivity (spec §3)', () => {
  const ids = { '1-Respond': 'L1', '2-Review': 'L2', '3-Waiting': 'L3' } as const

  it.each(GPS_LABELS)('applying %s removes the other two', (label) => {
    const change = buildLabelChange(label, ids)
    expect(change.addLabelIds).toEqual([ids[label]])
    expect(change.removeLabelIds).toHaveLength(2)
    expect(change.removeLabelIds).not.toContain(ids[label])
  })

  it('Archive removes INBOX and all GPS labels, adds nothing', () => {
    const change = buildLabelChange('Archive', ids)
    expect(change.addLabelIds).toEqual([])
    expect(change.removeLabelIds).toEqual(expect.arrayContaining(['INBOX', 'L1', 'L2', 'L3']))
  })
})

describe('parseClassification', () => {
  it('parses clean JSON', () => {
    const result = parseClassification(
      '{"label": "2-Review", "confidence": "high", "needs_reading": false, "reason": "automated report"}',
    )
    expect(result).toEqual({
      label: '2-Review',
      confidence: 'high',
      needsReading: false,
      reason: 'automated report',
    })
  })

  it('parses JSON wrapped in prose or fences', () => {
    const result = parseClassification(
      'Here is my classification:\n```json\n{"label": "Archive", "confidence": "high", "needs_reading": false, "reason": "receipt"}\n```',
    )
    expect(result.label).toBe('Archive')
  })

  it('falls back to conservative 1-Respond low-confidence on garbage', () => {
    const result = parseClassification('I think this is probably fine to skip.')
    expect(result).toMatchObject({ label: '1-Respond', confidence: 'low' })
  })

  it('rejects labels outside the allowed set (3-Waiting is never the model’s call)', () => {
    const result = parseClassification(
      '{"label": "3-Waiting", "confidence": "high", "needs_reading": false, "reason": "x"}',
    )
    expect(result).toMatchObject({ label: '1-Respond', confidence: 'low' })
  })
})

describe('prompt assembly', () => {
  const files = { arya: 'ARYA-CONTENT', labelTaxonomy: 'TAXONOMY', triageRules: 'RULES' }

  it('loads ARYA.md first (CLAUDE.md: it is the system prompt)', () => {
    const prompt = buildSystemPrompt(files)
    expect(prompt.indexOf('ARYA-CONTENT')).toBe(0)
    expect(prompt.indexOf('TAXONOMY')).toBeLessThan(prompt.indexOf('RULES'))
  })

  it('states the allowed labels', () => {
    const prompt = buildSystemPrompt(files, ['1-Respond', '2-Review'])
    expect(prompt).toContain('Allowed labels for this thread: 1-Respond, 2-Review.')
  })

  it('renders sender, subject, and attachments into the thread view', () => {
    const fixture = CLASSIFY_FIXTURES.find((f) => f.id === 'contract-redlines-attachment')!
    const rendered = renderThread(fixture.thread)
    expect(rendered).toContain('MSA redlines')
    expect(rendered).toContain('XCLSV_MSA_redlines_v3.docx')
    expect(rendered).toContain('dana.cole@rebetlegal.example.com')
  })
})

describe('StateStore', () => {
  it('round-trips and upserts idempotently', () => {
    const store = new StateStore(':memory:')
    const record = {
      threadId: 't1',
      label: '3-Waiting' as const,
      lowConfidence: false,
      needsReading: false,
      waitingSince: '2026-08-07',
      nudgeCount: 1,
      draftStatus: 'pending' as const,
      snoozedUntil: null,
      slackRefs: null,
      lastMessageId: 'm9',
      subject: 'Activation dates',
      reason: null,
    }
    store.upsert(record)
    store.upsert({ ...record, nudgeCount: 2 })
    expect(store.get('t1')).toMatchObject({ threadId: 't1', nudgeCount: 2 })
    expect(store.byLabel('3-Waiting')).toHaveLength(1)
    store.close()
  })
})

describe('fixture coverage (spec §3 — every label and tie-breaker)', () => {
  it('has at least 30 fixtures total', () => {
    const total =
      CLASSIFY_FIXTURES.length + OUTBOUND_LAST_FIXTURES.length + 2 // + inbound-on-waiting + skip
    expect(total).toBeGreaterThanOrEqual(30)
  })

  it('covers every label and every tie-breaker', () => {
    const tags = new Set([
      ...CLASSIFY_FIXTURES.flatMap((f) => f.tags),
      ...OUTBOUND_LAST_FIXTURES.flatMap((f) => f.tags),
      ...INBOUND_ON_WAITING_FIXTURE.tags,
      ...ALREADY_PROCESSED_FIXTURE.tags,
    ])
    for (const required of [
      '1-Respond', '2-Review', '3-Waiting', 'Archive',
      'direct-question', 'money', 'contract', 'deal', 'first-contact', 'vip',
      'unknown-ask', 'pitch', 'respond-beats-review', 'low-confidence', 'needs-reading',
      'report', 'cc-teammate', 'newsletter',
      'receipt', 'auto-reply', 'promo', 'closed-loop',
      'outbound-last', 'inbound-on-waiting', 'idempotent-skip',
    ]) {
      expect(tags, `missing coverage for "${required}"`).toContain(required)
    }
  })
})
