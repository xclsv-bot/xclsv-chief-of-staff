// Nudge engine — spec §8. Daily scan of the 3-Waiting ledger at 8:00 AM PT,
// before the digest. Threads past threshold get their follow-up PRE-drafted
// here (2–3 sentences, naming the specific open item, per nudge-rules.md); the
// digest pipeline then posts each pre-draft under its Ready Nudges item, where
// "nudge 4" / "approve 4" / ✅ sends it through the standard gate. After 2
// unanswered nudges a thread escalates to Flags (digest.ts) and this engine
// never drafts a third.

import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv, requireEnv } from '../config.js'
import { fetchThread, gmailClient } from '../connectors/gmail.js'
import { postAlert } from '../connectors/slack.js'
import { retrieveForDraft } from '../retrieval.js'
import { StateStore, type ThreadState } from '../state.js'
import { businessDaysBetween } from './digest.js'
import { generateDraft, loadDraftFiles, validateDraft } from './draft.js'

/**
 * Which 3-Waiting threads get a pre-drafted nudge this run: past threshold,
 * fewer than 2 nudges sent, not snoozed, no nudge draft already pending, and
 * backed by a real Gmail thread (call commitments have no thread to draft on).
 */
export function eligibleForNudge(
  waiting: ThreadState[],
  pendingNudgeThreadIds: Set<string>,
  now: Date,
  thresholdDays: number,
): ThreadState[] {
  return waiting.filter(
    (t) =>
      (!t.snoozedUntil || new Date(t.snoozedUntil) <= now) &&
      t.nudgeCount < 2 &&
      !pendingNudgeThreadIds.has(t.threadId) &&
      !t.threadId.startsWith('call:') &&
      businessDaysBetween(new Date(t.waitingSince ?? t.updatedAt), now) >= thresholdDays,
  )
}

async function run(dryRun: boolean): Promise<void> {
  const store = new StateStore(optionalEnv('STATE_DB_PATH', 'data/state.db'))
  const now = new Date()
  const threshold = Number(optionalEnv('NUDGE_THRESHOLD_DAYS', '3'))
  const pendingNudges = new Set(
    store
      .draftsByStatus('pending')
      .filter((d) => d.kind === 'nudge')
      .map((d) => d.threadId),
  )
  const eligible = eligibleForNudge(store.byLabel('3-Waiting'), pendingNudges, now, threshold)
  console.log(`nudge scan: ${eligible.length} thread(s) past threshold`)
  if (eligible.length === 0) {
    store.close()
    return
  }

  const gmail = gmailClient({
    clientId: requireEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
    refreshToken: requireEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
  })
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
  const model = optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-5')
  const files = loadDraftFiles()
  const owner = optionalEnv('ZAIRE_EMAIL', '').toLowerCase()
  let failures = 0

  for (const state of eligible) {
    try {
      const thread = await fetchThread(gmail, state.threadId)
      const instruction =
        'Send the follow-up nudge for this thread — we are waiting on them ' +
        `(${businessDaysBetween(new Date(state.waitingSince ?? state.updatedAt), now)} business days quiet).`
      const recipients = [
        ...new Set(
          thread.messages
            .flatMap((m) => `${m.from} ${m.to} ${m.cc}`.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])
            .map((a) => a.toLowerCase())
            .filter((a) => a !== owner),
        ),
      ]
      const examples = await retrieveForDraft({
        recipientEmails: recipients,
        queryText: `${thread.subject}\n${instruction}`,
        openaiKey: process.env.OPENAI_API_KEY,
      })
      const generated = await generateDraft(
        anthropic, model,
        { kind: 'nudge', thread, instruction, examples },
        files,
      )
      const warnings = validateDraft(generated, { kind: 'nudge', thread, instruction })
      if (dryRun) {
        console.log(`[dry-run] would pre-draft nudge: ${generated.headerLine}`)
        continue
      }
      store.createDraft({
        threadId: state.threadId,
        kind: 'nudge',
        status: 'pending',
        body: generated.body,
        toAddr: generated.to,
        ccAddr: generated.cc || null,
        subject: generated.subject,
        headerLine: generated.headerLine,
        instruction,
        warnings,
        channel: null,
        slackTs: null, // posted by the digest under its Ready Nudges item
        digestSlackTs: null,
        itemNumber: null,
      })
      console.log(`pre-drafted nudge: ${generated.headerLine}`)
    } catch (error) {
      failures++
      console.error(`nudge draft for thread ${state.threadId} failed:`, error)
    }
  }
  if (failures > 0) await postAlert(`nudge scan completed with ${failures} failures`)
  store.close()
}

const isMain = process.argv[1]?.endsWith('nudge.ts') || process.argv[1]?.endsWith('nudge.js')
if (isMain) {
  run(process.argv.includes('--dry-run')).catch(async (error) => {
    console.error('[alert] nudge scan failed entirely:', error)
    await postAlert(`nudge scan failed: ${(error as Error).message}`)
    process.exit(1)
  })
}
