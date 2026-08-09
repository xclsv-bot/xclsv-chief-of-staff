// Digest pipeline — spec §4. Posted to #inbox-gps at 8:00 AM and 3:00 PM PT
// (scheduled externally, like the sweep). Skipped if empty. Three sections:
//   A. Needs You — every 1-Respond thread, one numbered line each
//   B. Ready Nudges — 3-Waiting past threshold (nudge drafts attach in stage 6)
//   C. Flags — 2nd-unanswered-nudge threads, stale drafts (stage 4), and the
//      Friday-only 2-Review weekly rollup line
// Numbers are unique across sections and persisted (digests table) so the voice
// grammar (stage 4) can resolve "item 3" against the digest Zaire is answering.

import { optionalEnv, requireEnv } from '../config.js'
import { postMessage, slackClient } from '../connectors/slack.js'
import {
  StateStore,
  type DigestItemRef,
  type DraftRecord,
  type ThreadState,
} from '../state.js'

/** Spec §7.4: drafts unapproved after 24h surface in Flags. Never auto-approved. */
export function staleDraftFlags(pending: DraftRecord[], now: Date): string[] {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000).toISOString()
  return pending
    .filter((d) => d.createdAt <= cutoff)
    .map((d) => `Draft unapproved 24h+: ${d.headerLine ?? d.subject ?? d.threadId}`)
}

export const GMAIL_THREAD_URL = 'https://mail.google.com/mail/u/0/#all/'

/** Weekdays strictly after `from`, up to and including `to` (UTC dates). */
export function businessDaysBetween(from: Date, to: Date): number {
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  let count = 0
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count++
  }
  return count
}

function calendarDays(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000))
}

function itemLine(thread: ThreadState, now: Date): string {
  const summary = thread.digestLine ?? thread.subject ?? thread.threadId
  const tags = [
    thread.lowConfidence ? '(low confidence)' : null,
    thread.needsReading ? '(needs reading)' : null,
  ]
    .filter(Boolean)
    .join(' ')
  const age = thread.lastMessageDate
    ? `waiting ${calendarDays(new Date(thread.lastMessageDate), now)}d — `
    : ''
  return `${summary}${tags ? ` ${tags}` : ''} — ${age}<${GMAIL_THREAD_URL}${thread.threadId}|open>`
}

export interface DigestInput {
  respond: ThreadState[]
  waiting: ThreadState[]
  now: Date
  /** Default per nudge-rules.md: 3 business days. */
  nudgeThresholdDays: number
  cap?: number
  /** Provided on Fridays only: 2-Review threads rolled up this week (spec §4C). */
  reviewRollupCount?: number | null
  /** Extra flag lines from later stages (stale drafts, Arya task status). */
  extraFlags?: string[]
}

export interface BuiltDigest {
  empty: boolean
  text: string
  items: DigestItemRef[]
}

export function buildDigest(input: DigestInput): BuiltDigest {
  const { now } = input
  const cap = input.cap ?? 10
  const active = (t: ThreadState) =>
    !t.snoozedUntil || new Date(t.snoozedUntil) <= now

  const byAge = (a: ThreadState, b: ThreadState) =>
    (a.lastMessageDate ?? '9999').localeCompare(b.lastMessageDate ?? '9999')

  const respond = input.respond.filter(active).sort(byAge)
  const shown = respond.slice(0, cap)
  const overflow = respond.length - shown.length

  const waitingDays = (t: ThreadState) =>
    businessDaysBetween(new Date(t.waitingSince ?? t.updatedAt), now)
  const stale = input.waiting
    .filter(active)
    .filter((t) => waitingDays(t) >= input.nudgeThresholdDays)
    .sort(byAge)
  const readyNudges = stale.filter((t) => t.nudgeCount < 2)
  const escalated = stale.filter((t) => t.nudgeCount >= 2)

  const items: DigestItemRef[] = []
  const sections: string[] = []
  let n = 0

  if (shown.length > 0) {
    const lines = shown.map((t) => {
      items.push({ number: ++n, threadId: t.threadId, section: 'needs_you' })
      return `${n}) ${itemLine(t, now)}`
    })
    if (overflow > 0) lines.push(`_+${overflow} more in 1-Respond_`)
    sections.push(`*A. Needs You*\n${lines.join('\n')}`)
  }

  if (readyNudges.length > 0) {
    const lines = readyNudges.map((t) => {
      items.push({ number: ++n, threadId: t.threadId, section: 'ready_nudges' })
      return `${n}) ${itemLine(t, now)} — waiting ${waitingDays(t)} business days`
    })
    sections.push(`*B. Ready Nudges*\n${lines.join('\n')}`)
  }

  const flags: string[] = [
    ...escalated.map(
      (t) =>
        `${t.digestLine ?? t.subject ?? t.threadId} — 2 nudges unanswered: call, drop, or re-route?`,
    ),
    ...(input.extraFlags ?? []),
  ]
  if (input.reviewRollupCount != null && input.reviewRollupCount > 0) {
    flags.push(`2-Review weekly rollup: ${input.reviewRollupCount} threads this week`)
  }
  if (flags.length > 0) {
    sections.push(`*C. Flags*\n${flags.map((f) => `• ${f}`).join('\n')}`)
  }

  return {
    empty: sections.length === 0,
    text: sections.join('\n\n'),
    items,
  }
}

export function isFridayPT(now: Date): boolean {
  return (
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
    }).format(now) === 'Fri'
  )
}

async function run(dryRun: boolean): Promise<void> {
  const store = new StateStore(optionalEnv('STATE_DB_PATH', 'data/state.db'))
  const now = new Date()

  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const reviewRollupCount = isFridayPT(now)
    ? store.byLabel('2-Review').filter((t) => t.updatedAt >= weekAgo).length
    : null

  const digest = buildDigest({
    respond: store.byLabel('1-Respond'),
    waiting: store.byLabel('3-Waiting'),
    now,
    nudgeThresholdDays: Number(optionalEnv('NUDGE_THRESHOLD_DAYS', '3')),
    reviewRollupCount,
    extraFlags: staleDraftFlags(store.draftsByStatus('pending'), now),
  })

  if (digest.empty) {
    console.log('digest empty — skipped (spec §4)')
    store.close()
    return
  }

  if (dryRun) {
    console.log('[dry-run] would post digest:\n')
    console.log(digest.text)
  } else {
    const channel = requireEnv('SLACK_INBOX_GPS_CHANNEL_ID')
    const client = slackClient(requireEnv('SLACK_BOT_TOKEN'))
    const ts = await postMessage(client, channel, digest.text)
    store.saveDigest(channel, ts, digest.items)
    console.log(`digest posted (${digest.items.length} items, ts=${ts})`)
  }
  store.close()
}

const isMain = process.argv[1]?.endsWith('digest.ts') || process.argv[1]?.endsWith('digest.js')
if (isMain) {
  run(process.argv.includes('--dry-run')).catch(async (error) => {
    console.error('[alert] digest failed:', error)
    const { postAlert } = await import('../connectors/slack.js')
    await postAlert(`digest run failed: ${(error as Error).message}`)
    process.exit(1)
  })
}
