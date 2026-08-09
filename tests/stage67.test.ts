// Unit tests for the nudge engine (spec §8), Zoom ingestion (spec §13), and
// Asana routing (spec §14) — pure functions and state, no network, no LLM.

import { describe, expect, it } from 'vitest'
import { parseVtt } from '../src/connectors/zoom.js'
import {
  aryaTaskFlags,
  findDuplicateTask,
  parseTaskReading,
} from '../src/pipelines/asana_router.js'
import {
  parseActionItems,
  renderCallDigest,
  shouldRoute,
} from '../src/pipelines/call_ingest.js'
import { eligibleForNudge } from '../src/pipelines/nudge.js'
import { StateStore, type ThreadState } from '../src/state.js'

const NOW = new Date('2026-08-09T15:00:00Z') // Sunday

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString()
}

let nextId = 0
function waiting(partial: Partial<ThreadState>): ThreadState {
  return {
    threadId: `t${++nextId}`,
    label: '3-Waiting',
    lowConfidence: false,
    needsReading: false,
    waitingSince: daysAgo(6),
    nudgeCount: 0,
    draftStatus: 'none',
    snoozedUntil: null,
    slackRefs: null,
    lastMessageId: 'm1',
    lastMessageDate: daysAgo(6),
    subject: 'Activation dates',
    reason: null,
    digestLine: 'Jess / Rebet — activation dates',
    updatedAt: NOW.toISOString(),
    ...partial,
  }
}

describe('eligibleForNudge (spec §8)', () => {
  it('selects threads past 3 business days only', () => {
    const stale = waiting({})
    const fresh = waiting({ waitingSince: daysAgo(1) })
    expect(eligibleForNudge([stale, fresh], new Set(), NOW, 3)).toEqual([stale])
  })

  it('never drafts a third nudge (nudgeCount >= 2 escalates instead)', () => {
    expect(eligibleForNudge([waiting({ nudgeCount: 2 })], new Set(), NOW, 3)).toEqual([])
  })

  it('skips snoozed threads, already-pending nudges, and call commitments', () => {
    const snoozed = waiting({ snoozedUntil: daysAgo(-2) })
    const pending = waiting({})
    const callLedger = waiting({ threadId: 'call:uuid1:2' })
    expect(
      eligibleForNudge(
        [snoozed, pending, callLedger],
        new Set([pending.threadId]),
        NOW,
        3,
      ),
    ).toEqual([])
  })
})

describe('parseVtt (spec §13)', () => {
  it('strips WEBVTT headers, indices, and timestamps, keeping speaker lines', () => {
    const vtt = [
      'WEBVTT', '',
      '1', '00:00:01.000 --> 00:00:04.000',
      'Zaire Williams: Rebet will send redlines by Wednesday.',
      '',
      '2', '00:00:05.000 --> 00:00:08.000',
      'Jess Tran: Confirmed, Wednesday works.',
    ].join('\n')
    expect(parseVtt(vtt)).toBe(
      'Zaire Williams: Rebet will send redlines by Wednesday.\nJess Tran: Confirmed, Wednesday works.',
    )
  })
})

describe('parseActionItems (spec §13.2)', () => {
  it('parses owners and defaults ambiguous ownership to Zaire — never guesses', () => {
    const parsed = parseActionItems(
      `{"summary": "Launch planning.", "decisions": ["Both days on site"],
        "action_items": [
          {"owner_type": "arya", "owner_name": "Arya", "description": "Send the deck", "due": null},
          {"owner_type": "someone??", "owner_name": "", "description": "Own the venue question", "due": "2026-08-14"}
        ]}`,
    )
    expect(parsed.items[0]).toMatchObject({ ownerType: 'arya' })
    expect(parsed.items[1]).toMatchObject({ ownerType: 'zaire', due: '2026-08-14' })
  })

  it('returns empty on garbage', () => {
    expect(parseActionItems('great call everyone').items).toEqual([])
  })
})

describe('shouldRoute (spec §13 correction window)', () => {
  const call = { executeAfter: '2026-08-09T15:30:00.000Z' }
  it('waits out the 30-minute window', () => {
    expect(shouldRoute(call, new Date('2026-08-09T15:10:00Z'), false)).toBe(false)
    expect(shouldRoute(call, new Date('2026-08-09T15:31:00Z'), false)).toBe(true)
  })
  it('routes immediately on ✅', () => {
    expect(shouldRoute(call, new Date('2026-08-09T15:01:00Z'), true)).toBe(true)
  })
})

describe('renderCallDigest', () => {
  it('summary, decisions, numbered owner-tagged items, correction footer', () => {
    const text = renderCallDigest(
      'Rebet launch sync', 'Launch planning call.', ['Both days on site'],
      [
        { ownerType: 'zaire', ownerName: 'Zaire', description: 'Confirm budget owner', due: null },
        { ownerType: 'external', ownerName: 'Rebet', description: 'Send redlines', due: '2026-08-12' },
      ],
      30,
    )
    expect(text).toContain('*Call digest: Rebet launch sync*')
    expect(text).toContain('• Both days on site')
    expect(text).toContain('1. [zaire: Zaire] Confirm budget owner')
    expect(text).toContain('2. [external: Rebet] Send redlines — by 2026-08-12')
    expect(text).toContain('within 30 min')
  })
})

describe('findDuplicateTask (spec §14 dedupe)', () => {
  const open = [
    { gid: 'g1', name: 'Send Tony payment dates' },
    { gid: 'g2', name: 'Review MLR season deck' },
  ]
  it('matches the same ask phrased slightly differently', () => {
    expect(findDuplicateTask('Send payment dates to Tony', open)?.gid).toBe('g1')
  })
  it('does not match a different ask', () => {
    expect(findDuplicateTask('Book travel for launch weekend', open)).toBeNull()
  })
})

describe('parseTaskReading (spec §14.1)', () => {
  it('parses a valid reading', () => {
    expect(
      parseTaskReading('{"assessment": "plan", "comment": "Interpreting this as: draft the intro."}'),
    ).toEqual({ assessment: 'plan', comment: 'Interpreting this as: draft the intro.' })
  })
  it('falls back to a clarifying question on garbage — never guesses on thin input', () => {
    expect(parseTaskReading('hmm').assessment).toBe('too_thin')
  })
})

describe('aryaTaskFlags (spec §14.1 status visibility)', () => {
  it('flags clarifications, out-of-lane routing, and 3+ business-day staleness', () => {
    const flags = aryaTaskFlags(
      [
        { gid: 'g1', title: 'follow up w/ that guy', status: 'clarify', pickedAt: daysAgo(1), updatedAt: daysAgo(1) },
        { gid: 'g2', title: 'negotiate the Rebet rate', status: 'out_of_lane', pickedAt: daysAgo(1), updatedAt: daysAgo(1) },
        { gid: 'g3', title: 'send the MLR report', status: 'interpreted', pickedAt: daysAgo(6), updatedAt: daysAgo(6) },
        { gid: 'g4', title: 'fresh task', status: 'interpreted', pickedAt: daysAgo(1), updatedAt: daysAgo(1) },
        { gid: 'g5', title: 'old but done', status: 'done', pickedAt: daysAgo(10), updatedAt: daysAgo(1) },
      ],
      NOW,
    )
    expect(flags).toHaveLength(3)
    expect(flags[0]).toContain('follow up w/ that guy')
    expect(flags[1]).toContain('outside Arya')
    expect(flags[2]).toContain('send the MLR report')
  })
})

describe('state: calls and arya_tasks', () => {
  it('round-trips call records through the correction window lifecycle', () => {
    const store = new StateStore(':memory:')
    store.saveCall({
      meetingUuid: 'uuid1',
      topic: 'Rebet launch sync',
      channel: 'C1',
      slackTs: '300.1',
      status: 'pending',
      actionItems: [
        { ownerType: 'zaire', ownerName: 'Zaire', description: 'Confirm', due: null },
      ],
      executeAfter: '2026-08-09T15:30:00.000Z',
    })
    expect(store.pendingCalls()).toHaveLength(1)
    const call = store.getCall('uuid1')!
    store.saveCall({ ...call, status: 'routed' })
    expect(store.pendingCalls()).toHaveLength(0)
    store.close()
  })

  it('round-trips Arya task pickups', () => {
    const store = new StateStore(':memory:')
    store.upsertAryaTask({ gid: 'g1', title: 'send deck', status: 'interpreted', pickedAt: daysAgo(0) })
    store.upsertAryaTask({ gid: 'g1', title: 'send deck', status: 'done', pickedAt: daysAgo(0) })
    expect(store.getAryaTask('g1')?.status).toBe('done')
    expect(store.allAryaTasks()).toHaveLength(1)
    store.close()
  })

  it('attaches stored nudge pre-drafts to their Slack posts', () => {
    const store = new StateStore(':memory:')
    const id = store.createDraft({
      threadId: 't1', kind: 'nudge', status: 'pending', body: 'Following up on the links.',
      toAddr: 'jess@rebet.example.com', ccAddr: null, subject: 'Re: Links',
      headerLine: 'To Jess (Rebet) — Re: Links', instruction: 'nudge',
      warnings: ['contains a number Zaire didn\'t say: "50k" — hard rule 3'],
      channel: null, slackTs: null, digestSlackTs: null, itemNumber: null,
    })
    store.setDraftSlackRefs(id, {
      channel: 'C1', slackTs: '400.2', digestSlackTs: '400.1', itemNumber: 4,
    })
    const draft = store.draftsByStatus('pending')[0]!
    expect(draft).toMatchObject({ slackTs: '400.2', itemNumber: 4 })
    expect(draft.warnings).toHaveLength(1)
    store.close()
  })
})
