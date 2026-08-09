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

function spokenLine(thread: ThreadState, now: Date): string {
  const summary = thread.digestLine ?? thread.subject ?? 'an unlabeled thread'
  const tags = [
    thread.lowConfidence ? "I'm not fully sure this one needs you" : null,
    thread.needsReading ? 'this one needs a proper read' : null,
  ]
    .filter(Boolean)
    .join('; ')
  const days = thread.lastMessageDate
    ? calendarDays(new Date(thread.lastMessageDate), now)
    : null
  const age =
    days === null ? '' : days === 0 ? ', from today' : days === 1 ? ', waiting 1 day' : `, waiting ${days} days`
  return `${summary}${age}${tags ? ` — ${tags}` : ''}`
}

export interface BuiltDigest {
  empty: boolean
  text: string
  /** The same digest written for the ear — read aloud by TTS, no links. */
  speech: string
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
  const spoken: string[] = []
  let n = 0

  if (shown.length > 0) {
    spoken.push(
      shown.length === 1
        ? 'One thing needs you.'
        : `${shown.length} things need you.`,
    )
    const lines = shown.map((t) => {
      items.push({ number: ++n, threadId: t.threadId, section: 'needs_you' })
      spoken.push(`Number ${n}. ${spokenLine(t, now)}.`)
      return `${n}) ${itemLine(t, now)}`
    })
    if (overflow > 0) {
      lines.push(`_+${overflow} more in 1-Respond_`)
      spoken.push(`Plus ${overflow} more waiting in 1-Respond beyond the cap.`)
    }
    sections.push(`*A. Needs You*\n${lines.join('\n')}`)
  }

  if (readyNudges.length > 0) {
    spoken.push(
      readyNudges.length === 1
        ? 'One follow-up is ready to go.'
        : `${readyNudges.length} follow-ups are ready to go.`,
    )
    const lines = readyNudges.map((t) => {
      items.push({ number: ++n, threadId: t.threadId, section: 'ready_nudges' })
      spoken.push(
        `Number ${n}. ${spokenLine(t, now)} — ${waitingDays(t)} business days quiet. Say nudge ${n} to send it.`,
      )
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
    spoken.push(
      flags.length === 1 ? `One flag: ${flags[0]}.` : `${flags.length} flags. ${flags.join('. ')}.`,
    )
  }

  spoken.push(
    'Reply here when ready — voice or text. Item numbers plus what to do: ' +
      'tell, push, skip, archive, delegate, nudge, or approve.',
  )

  return {
    empty: sections.length === 0,
    text: sections.join('\n\n'),
    speech: sections.length === 0 ? '' : spoken.join(' '),
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

  const { aryaTaskFlags } = await import('./asana_router.js')
  const digest = buildDigest({
    respond: store.byLabel('1-Respond'),
    waiting: store.byLabel('3-Waiting'),
    now,
    nudgeThresholdDays: Number(optionalEnv('NUDGE_THRESHOLD_DAYS', '3')),
    reviewRollupCount,
    extraFlags: [
      ...staleDraftFlags(store.draftsByStatus('pending'), now),
      ...aryaTaskFlags(store.allAryaTasks(), now),
    ],
  })

  if (digest.empty) {
    console.log('digest empty — skipped (spec §4)')
    store.close()
    return
  }

  if (dryRun) {
    console.log('[dry-run] would post digest:\n')
    console.log(digest.text)
    console.log('\n[dry-run] audio script:\n')
    console.log(digest.speech)
  } else {
    const channel = requireEnv('SLACK_INBOX_GPS_CHANNEL_ID')
    const client = slackClient(requireEnv('SLACK_BOT_TOKEN'))
    const ts = await postMessage(client, channel, digest.text)
    store.saveDigest(channel, ts, digest.items)
    console.log(`digest posted (${digest.items.length} items, ts=${ts})`)

    // Pre-drafted nudges (spec §8/§4B): post each under its Ready Nudges item so
    // "nudge 4" / "approve 4" / ✅ can send it through the standard gate.
    const nudgeDrafts = store
      .draftsByStatus('pending')
      .filter((d) => d.kind === 'nudge' && d.slackTs === null)
    for (const item of digest.items.filter((i) => i.section === 'ready_nudges')) {
      const draft = nudgeDrafts.find((d) => d.threadId === item.threadId)
      if (!draft) continue
      const { buildDraftPost } = await import('./draft.js')
      const post = buildDraftPost(
        {
          to: draft.toAddr ?? '',
          cc: draft.ccAddr ?? '',
          subject: draft.subject ?? '',
          body: draft.body,
          headerLine: `#${item.number} · ${draft.headerLine ?? draft.subject ?? ''}`,
        },
        draft.warnings ?? [],
      )
      const { postThreadReply } = await import('../connectors/slack.js')
      const draftTs = await postThreadReply(client, channel, ts, post)
      store.setDraftSlackRefs(draft.id, {
        channel,
        slackTs: draftTs,
        digestSlackTs: ts,
        itemNumber: item.number,
      })
    }

    // Audio digest: same rundown, for the ear (dog walks, the car). Optional —
    // configured via ELEVENLABS_API_KEY — and never allowed to sink the digest.
    const ttsKey = process.env.ELEVENLABS_API_KEY
    if (ttsKey && digest.speech) {
      try {
        const { synthesize } = await import('../tts.js')
        const { uploadAudio } = await import('../connectors/slack.js')
        const audio = await synthesize(
          digest.speech,
          ttsKey,
          optionalEnv('ELEVENLABS_VOICE_ID', '21m00Tcm4TlvDq8ikWAM'),
        )
        await uploadAudio(client, channel, ts, audio, 'digest.mp3', 'Listen to this digest')
        console.log('audio digest attached')
      } catch (error) {
        console.error('audio digest failed (text digest unaffected):', error)
      }
    }
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
