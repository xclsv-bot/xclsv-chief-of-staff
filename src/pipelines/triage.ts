// Triage pipeline — the hourly Email GPS labeling sweep (spec §3).
//
// Stage 2 scope: labeling only (shadow labeling, rollout days 1–4). No digest,
// no drafts, no nudges. Run with --dry-run to log intended actions without
// touching Gmail. Idempotent: a thread whose newest message was already
// processed is skipped, so re-running a sweep changes nothing.

import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv, requireEnv } from '../config.js'
import {
  applyGpsLabel,
  ensureGpsLabels,
  fetchThread,
  gmailClient,
  listInboxThreadIds,
  type GmailGpsLabel,
  type ThreadSummary,
} from '../connectors/gmail.js'
import { postAlert } from '../connectors/slack.js'
import { StateStore, type GpsLabel, type ThreadState } from '../state.js'
import {
  classifyThread,
  loadAgentFiles,
  type Classification,
} from './classify.js'

export type Decision =
  | { type: 'skip'; reason: string }
  | { type: 'waiting'; cancelDraft: boolean; reason: string }
  | { type: 'classify'; allowed?: GpsLabel[]; resetNudges: boolean }

function senderEmail(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match?.[1] ?? from).trim().toLowerCase()
}

/**
 * The deterministic layer of triage (spec §3, §10). Judgment calls go to the
 * classifier; everything mechanical is decided here so it is unit-testable and
 * never depends on a model:
 *  - unchanged thread → skip (idempotency)
 *  - Zaire replied last → 3-Waiting, cancel any pending draft
 *  - inbound reply on 3-Waiting → reclassify (1-Respond/2-Review only), reset nudges
 */
export function decideAction(input: {
  state?: ThreadState
  thread: ThreadSummary
  ownerEmails: string[]
}): Decision {
  const { state, thread, ownerEmails } = input
  const newest = thread.messages[thread.messages.length - 1]
  if (!newest) return { type: 'skip', reason: 'empty thread' }
  if (state && state.lastMessageId === newest.id) {
    return { type: 'skip', reason: 'newest message already triaged' }
  }
  const owners = ownerEmails.map((e) => e.toLowerCase())
  if (owners.includes(senderEmail(newest.from))) {
    return {
      type: 'waiting',
      cancelDraft: state?.draftStatus === 'pending',
      reason: 'Zaire replied last — ball is in their court',
    }
  }
  if (state?.label === '3-Waiting') {
    return {
      type: 'classify',
      allowed: ['1-Respond', '2-Review'],
      resetNudges: true,
    }
  }
  return { type: 'classify', resetNudges: false }
}

interface SweepOptions {
  dryRun: boolean
  maxThreads: number
  /** Overrides for callers not running from the repo root (voice, commands). */
  agentDir?: string
  statePath?: string
}

export interface SweepResult {
  candidates: number
  counts: Record<string, number>
  failures: number
  /** Digest lines of threads newly labeled 1-Respond this run. */
  newRespond: string[]
}

/**
 * One triage sweep, callable in-process (voice tool, Slack command) as well as
 * from the CLI. Idempotent as ever — already-triaged threads skip, so an
 * on-demand run between cron runs is cheap.
 */
export async function runSweep(options: SweepOptions): Promise<SweepResult> {
  const files = loadAgentFiles(options.agentDir)
  const store = new StateStore(
    options.statePath ?? optionalEnv('STATE_DB_PATH', 'data/state.db'),
  )
  const gmail = gmailClient({
    clientId: requireEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
    refreshToken: requireEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
  })
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
  const model = optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-5')
  const ownerEmails = [requireEnv('ZAIRE_EMAIL')]

  const labelIds = options.dryRun ? null : await ensureGpsLabels(gmail)

  // Candidates: everything in the inbox, plus 3-Waiting threads (which may be
  // out of the inbox) so inbound replies relabel immediately (spec §8).
  const inboxIds = await listInboxThreadIds(gmail, options.maxThreads)
  const waitingIds = store.byLabel('3-Waiting').map((t) => t.threadId)
  const candidates = [...new Set([...inboxIds, ...waitingIds])]

  const counts: Record<string, number> = {}
  const newRespond: string[] = []
  let failures = 0

  for (const threadId of candidates) {
    try {
      const thread = await fetchThread(gmail, threadId)
      const state = store.get(threadId)
      const decision = decideAction({ state, thread, ownerEmails })
      if (decision.type === 'skip') continue

      const newest = thread.messages[thread.messages.length - 1]!
      let label: GpsLabel
      let classification: Classification | null = null

      if (decision.type === 'waiting') {
        label = '3-Waiting'
      } else {
        classification = await classifyThread(
          anthropic, model, thread, files, decision.allowed,
        )
        label = classification.label
      }

      const tag =
        classification?.confidence === 'low' ? ' (low confidence)'
        : classification?.needsReading ? ' (needs reading)'
        : ''
      const line = `${label}${tag}  "${thread.subject}"  — ${
        classification?.reason ?? (decision.type === 'waiting' ? decision.reason : '')
      }`

      if (options.dryRun) {
        console.log(`[dry-run] would label: ${line}`)
      } else {
        await applyGpsLabel(
          gmail, threadId,
          label === 'Archive' ? 'Archive' : (label as GmailGpsLabel),
          labelIds!,
        )
        const newestDate = Number.isNaN(Date.parse(newest.date))
          ? null
          : new Date(newest.date).toISOString()
        store.upsert({
          threadId,
          label,
          lowConfidence: classification?.confidence === 'low',
          needsReading: classification?.needsReading ?? false,
          // Spec §8: the nudge threshold counts from the LAST OUTBOUND — a fresh
          // outbound (including a sent nudge) always resets the clock.
          waitingSince: label === '3-Waiting' ? newestDate : null,
          nudgeCount:
            decision.type === 'classify' && decision.resetNudges
              ? 0
              : label === '3-Waiting'
                ? (state?.label === '3-Waiting' ? state.nudgeCount : 0)
                : 0,
          draftStatus:
            decision.type === 'waiting' && decision.cancelDraft
              ? 'none'
              : (state?.draftStatus ?? 'none'),
          snoozedUntil: state?.snoozedUntil ?? null,
          slackRefs: state?.slackRefs ?? null,
          lastMessageId: newest.id,
          lastMessageDate: newestDate,
          subject: thread.subject,
          reason: classification?.reason ?? null,
          digestLine: classification?.digestLine ?? state?.digestLine ?? null,
        })
        console.log(`labeled: ${line}`)
        if (label === '1-Respond' && state?.label !== '1-Respond') {
          newRespond.push(classification?.digestLine ?? thread.subject)
        }
      }
      counts[label] = (counts[label] ?? 0) + 1
    } catch (error) {
      failures++
      console.error(`thread ${threadId} failed:`, error)
    }
  }

  const summary = Object.entries(counts)
    .map(([label, n]) => `${label}: ${n}`)
    .join(', ')
  console.log(
    `sweep done${options.dryRun ? ' (dry-run)' : ''} — ${candidates.length} candidates` +
      (summary ? ` — ${summary}` : ' — nothing to do'),
  )
  if (failures > 0) {
    // One alert line, never silent failure (spec §10). postAlert falls back to
    // stderr when Slack isn't configured.
    await postAlert(`triage sweep completed with ${failures} thread failures`)
  }
  store.close()
  return { candidates: candidates.length, counts, failures, newRespond }
}

/** Spoken/Slack-friendly one-liner for an on-demand sweep result. */
export function summarizeSweep(result: SweepResult): string {
  const parts: string[] = []
  const respond = result.counts['1-Respond'] ?? 0
  if (result.newRespond.length > 0) {
    parts.push(
      `${result.newRespond.length === 1 ? 'One new thing needs' : `${result.newRespond.length} new things need`} you: ${result.newRespond.slice(0, 5).join('; ')}.`,
    )
  } else if (respond > 0) {
    parts.push('Nothing new needs you beyond what was already on the list.')
  } else {
    parts.push('Nothing new needs you.')
  }
  const review = result.counts['2-Review'] ?? 0
  const archived = result.counts['Archive'] ?? 0
  const filed: string[] = []
  if (review > 0) filed.push(`${review} filed to review`)
  if (archived > 0) filed.push(`${archived} archived`)
  if (filed.length > 0) parts.push(`Also ${filed.join(' and ')}.`)
  if (result.failures > 0) parts.push(`${result.failures} thread(s) failed — I'll catch them next run.`)
  return parts.join(' ')
}

const isMain = process.argv[1]?.endsWith('triage.ts') || process.argv[1]?.endsWith('triage.js')
if (isMain) {
  runSweep({
    dryRun: process.argv.includes('--dry-run'),
    maxThreads: Number(optionalEnv('TRIAGE_MAX_THREADS', '100')),
  }).catch((error) => {
    console.error('[alert] sweep failed entirely:', error)
    process.exit(1)
  })
}
