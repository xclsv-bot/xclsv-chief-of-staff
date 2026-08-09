// Unit tests for the digest builder (spec §4) — pure functions, no Slack, no LLM.

import { describe, expect, it } from 'vitest'
import { buildDigest, businessDaysBetween, isFridayPT } from '../src/pipelines/digest.js'
import type { ThreadState } from '../src/state.js'

// A Sunday, so "N days ago" in fixtures never straddles a weekend ambiguously.
const NOW = new Date('2026-08-09T15:00:00Z')

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

let nextId = 0
function thread(partial: Partial<ThreadState>): ThreadState {
  return {
    threadId: `t${++nextId}`,
    label: '1-Respond',
    lowConfidence: false,
    needsReading: false,
    waitingSince: null,
    nudgeCount: 0,
    draftStatus: 'none',
    snoozedUntil: null,
    slackRefs: null,
    lastMessageId: 'm1',
    lastMessageDate: daysAgo(1),
    subject: 'A subject',
    reason: null,
    digestLine: null,
    updatedAt: NOW.toISOString(),
    ...partial,
  }
}

function build(overrides: Partial<Parameters<typeof buildDigest>[0]> = {}) {
  return buildDigest({
    respond: [],
    waiting: [],
    now: NOW,
    nudgeThresholdDays: 3,
    ...overrides,
  })
}

describe('businessDaysBetween', () => {
  it('counts weekdays only', () => {
    const friday = new Date('2026-08-07T12:00:00Z')
    const monday = new Date('2026-08-10T12:00:00Z')
    const thursday = new Date('2026-08-13T12:00:00Z')
    expect(businessDaysBetween(friday, monday)).toBe(1)
    expect(businessDaysBetween(friday, thursday)).toBe(4)
    expect(businessDaysBetween(friday, friday)).toBe(0)
  })
})

describe('buildDigest — spec §4', () => {
  it('is empty (and thus skipped) when nothing needs attention', () => {
    expect(build().empty).toBe(true)
  })

  it('renders Needs You lines with digest line, age, and link', () => {
    const digest = build({
      respond: [
        thread({
          threadId: 'abc123',
          digestLine: 'Luis / Outlier — asking to confirm September slate scope',
          lastMessageDate: daysAgo(3),
        }),
      ],
    })
    expect(digest.empty).toBe(false)
    expect(digest.text).toContain('*A. Needs You*')
    expect(digest.text).toContain(
      '1) Luis / Outlier — asking to confirm September slate scope — waiting 3d — <https://mail.google.com/mail/u/0/#all/abc123|open>',
    )
  })

  it('sorts oldest first and caps at 10 with an overflow note', () => {
    const respond = Array.from({ length: 13 }, (_, i) =>
      thread({ digestLine: `item aged ${i}d`, lastMessageDate: daysAgo(i) }),
    )
    const digest = build({ respond })
    const lines = digest.text.split('\n')
    expect(lines[1]).toContain('item aged 12d') // oldest first
    expect(digest.items).toHaveLength(10)
    expect(digest.text).toContain('_+3 more in 1-Respond_')
  })

  it('shows low-confidence and needs-reading tags (spec §3, §10)', () => {
    const digest = build({
      respond: [
        thread({ digestLine: 'Unknown / pitch', lowConfidence: true }),
        thread({ digestLine: 'Dana / Rebet — MSA redlines', needsReading: true }),
      ],
    })
    expect(digest.text).toContain('Unknown / pitch (low confidence)')
    expect(digest.text).toContain('Dana / Rebet — MSA redlines (needs reading)')
  })

  it('excludes snoozed threads until their date passes (Push verb)', () => {
    const digest = build({
      respond: [
        thread({ digestLine: 'snoozed away', snoozedUntil: daysAgo(-2) }),
        thread({ digestLine: 'snooze expired', snoozedUntil: daysAgo(1) }),
      ],
    })
    expect(digest.text).not.toContain('snoozed away')
    expect(digest.text).toContain('snooze expired')
  })

  it('puts 3-Waiting threads past 3 business days in Ready Nudges', () => {
    const digest = build({
      waiting: [
        thread({ label: '3-Waiting', digestLine: 'stale one', waitingSince: daysAgo(6) }),
        thread({ label: '3-Waiting', digestLine: 'still fresh', waitingSince: daysAgo(1) }),
      ],
    })
    expect(digest.text).toContain('*B. Ready Nudges*')
    expect(digest.text).toContain('stale one')
    expect(digest.text).not.toContain('still fresh')
  })

  it('numbers continuously across sections for unambiguous voice reference', () => {
    const digest = build({
      respond: [thread({ digestLine: 'respond item' })],
      waiting: [thread({ label: '3-Waiting', digestLine: 'stale item', waitingSince: daysAgo(6) })],
    })
    expect(digest.text).toContain('1) respond item')
    expect(digest.text).toContain('2) stale item')
    expect(digest.items).toEqual([
      { number: 1, threadId: expect.any(String), section: 'needs_you' },
      { number: 2, threadId: expect.any(String), section: 'ready_nudges' },
    ])
  })

  it('escalates threads on their 2nd unanswered nudge to Flags (spec §8)', () => {
    const digest = build({
      waiting: [
        thread({
          label: '3-Waiting',
          digestLine: 'gone quiet',
          waitingSince: daysAgo(10),
          nudgeCount: 2,
        }),
      ],
    })
    expect(digest.text).toContain('*C. Flags*')
    expect(digest.text).toContain('gone quiet — 2 nudges unanswered: call, drop, or re-route?')
    expect(digest.text).not.toContain('*B. Ready Nudges*')
  })

  it('includes the Friday 2-Review rollup line only when a count is provided', () => {
    const withRollup = build({
      respond: [thread({})],
      reviewRollupCount: 7,
    })
    expect(withRollup.text).toContain('2-Review weekly rollup: 7 threads this week')
    const withoutRollup = build({
      respond: [thread({})],
      reviewRollupCount: null,
    })
    expect(withoutRollup.text).not.toContain('weekly rollup')
  })
})

describe('speech script (audio digest)', () => {
  it('reads the same items aloud — numbered, aged in words, no links', () => {
    const digest = build({
      respond: [
        thread({
          digestLine: 'Luis / Outlier — asking to confirm September slate scope',
          lastMessageDate: daysAgo(3),
        }),
      ],
      waiting: [
        thread({ label: '3-Waiting', digestLine: 'Jess / Rebet — activation dates', waitingSince: daysAgo(6) }),
      ],
    })
    expect(digest.speech).toContain('One thing needs you.')
    expect(digest.speech).toContain(
      'Number 1. Luis / Outlier — asking to confirm September slate scope, waiting 3 days.',
    )
    expect(digest.speech).toContain('Say nudge 2 to send it.')
    expect(digest.speech).toContain('Reply here when ready')
    expect(digest.speech).not.toContain('http')
    expect(digest.speech).not.toContain('<')
  })

  it('is empty when the digest is empty', () => {
    expect(build().speech).toBe('')
  })
})

describe('isFridayPT', () => {
  it('uses Pacific time, not UTC', () => {
    // Saturday 02:00 UTC is still Friday evening in PT.
    expect(isFridayPT(new Date('2026-08-08T02:00:00Z'))).toBe(true)
    expect(isFridayPT(new Date('2026-08-08T20:00:00Z'))).toBe(false)
  })
})
