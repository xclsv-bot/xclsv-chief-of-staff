// Voice memo → parse → draft → approval gate (spec §5–7).
//
// Poll-based to match the scheduled-runs architecture: each run scans recent
// #inbox-gps digest threads for (a) new messages from Zaire — voice notes are
// transcribed, then the voice-command grammar is parsed per item — and (b) ✅
// reactions on pending draft posts, which finalize the draft in Gmail Drafts.
// Run it every few minutes during working hours (see README).
//
// Hard rule 5 is structural here: ONLY messages from Zaire's Slack user ID are
// ever treated as instructions. Everything else in the channel is scenery.

import Anthropic from '@anthropic-ai/sdk'
import { optionalEnv, requireEnv } from '../config.js'
import {
  applyGpsLabel,
  createReplyDraft,
  ensureGpsLabels,
  fetchThread,
  gmailClient,
  type GmailGpsLabel,
} from '../connectors/gmail.js'
import {
  downloadFile,
  fetchHistory,
  fetchReplies,
  postAlert,
  postThreadReply,
  slackClient,
  type SlackMessage,
} from '../connectors/slack.js'
import { retrieveForDraft } from '../retrieval.js'
import { StateStore, type DigestRecord, type DraftRecord } from '../state.js'
import { transcribe } from '../transcribe.js'
import { loadAgentFiles, type AgentFiles } from './classify.js'
import {
  buildDraftPost,
  generateDraft,
  loadDraftFiles,
  validateDraft,
  type DraftFiles,
} from './draft.js'

export const APPROVE_EMOJI = ['white_check_mark', 'heavy_check_mark']

// ── Voice-command grammar (spec §5) ─────────────────────────────────────────

export type MemoVerb =
  | 'reply'
  | 'revise'
  | 'approve'
  | 'snooze'
  | 'skip'
  | 'archive'
  | 'delegate'
  | 'nudge'
  | 'clarify'

export interface MemoAction {
  verb: MemoVerb
  itemNumber: number | null
  /** The stated content/instruction for reply, revise, delegate. */
  content: string
  delegateTo: string | null
  /** ISO date for snooze; null → default 3 business days. */
  snoozeUntil: string | null
  /** For clarify: the question to post ("Did you mean #2 or #5?"). */
  question: string | null
}

const VERBS: MemoVerb[] = [
  'reply', 'revise', 'approve', 'snooze', 'skip', 'archive', 'delegate', 'nudge',
  'clarify',
]

/** Tolerant parse of the grammar model's output; garbage → [] (caller asks). */
export function parseActions(text: string): MemoAction[] {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0]) as {
      actions?: {
        verb?: string
        item_number?: number | null
        content?: string
        delegate_to?: string | null
        snooze_until?: string | null
        question?: string | null
      }[]
    }
    return (parsed.actions ?? [])
      .filter((a) => VERBS.includes(a.verb as MemoVerb))
      .map((a) => ({
        verb: a.verb as MemoVerb,
        itemNumber: typeof a.item_number === 'number' ? a.item_number : null,
        content: a.content ?? '',
        delegateTo: a.delegate_to ?? null,
        snoozeUntil: a.snooze_until ?? null,
        question: a.question ?? null,
      }))
  } catch {
    return []
  }
}

/** Spec §5 ambiguity rule: "the later instruction wins per item." */
export function lastWinsPerItem(actions: MemoAction[]): MemoAction[] {
  const byItem = new Map<number, MemoAction>()
  const unnumbered: MemoAction[] = []
  for (const action of actions) {
    if (action.itemNumber === null) unnumbered.push(action)
    else byItem.set(action.itemNumber, action)
  }
  return [...unnumbered, ...byItem.values()]
}

export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from)
  let remaining = days
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    const day = result.getUTCDay()
    if (day !== 0 && day !== 6) remaining--
  }
  return result
}

export interface ParserItem {
  number: number
  line: string
  section: string
  threadId: string
  draftStatus: 'none' | 'pending' | 'approved'
}

export function buildMemoSystemPrompt(
  files: AgentFiles,
  items: ParserItem[],
  now: Date,
): string {
  return [
    files.arya,
    '---',
    files.triageRules,
    '---',
    '# Current task: parse Zaire\'s digest reply into per-item actions',
    '',
    `Today is ${now.toISOString().slice(0, 10)}.`,
    'Zaire replied to a digest (voice memo transcript or text). Split it per item',
    'and apply exactly one verb per item, per the voice-command grammar in',
    'triage-rules.md. Items he does not mention get NO action (skip is implicit).',
    '',
    '## The digest items',
    ...items.map(
      (i) =>
        `${i.number}) [thread ${i.threadId}] [draft: ${i.draftStatus}] (${i.section}) ${i.line}`,
    ),
    '',
    'Verbs: reply (draft a reply carrying his stated content) · revise (changes to',
    'an existing pending draft — use when the item already has draft: pending and',
    'he is adjusting it) · approve ("approve #2", "send it", "looks good" on an item',
    'with draft: pending — finalizes that draft in Gmail, same as a ✅ reaction) ·',
    'snooze (resurface later; snooze_until as YYYY-MM-DD if he named a day, else',
    'null) · skip · archive · delegate (delegate_to = teammate name) · nudge',
    '(approve/send the follow-up for a Ready Nudges item).',
    '',
    'AMBIGUITY RULE (hard): if an instruction cannot be confidently matched to',
    'exactly ONE item, do not guess — emit verb "clarify" with item_number null and',
    'a question naming the candidates ("Did you mean #2 (…) or #5 (…)?").',
    'For reply/revise/delegate, "content" must carry everything Zaire said for that',
    'item — the drafter sees only your extraction, so keep his numbers and wording.',
    '',
    'Respond with ONLY JSON:',
    '{"actions": [{"verb": "...", "item_number": 2, "content": "...",',
    '  "delegate_to": null, "snooze_until": null, "question": null}]}',
  ].join('\n')
}

// ── Poller ──────────────────────────────────────────────────────────────────

interface Runtime {
  store: StateStore
  slack: ReturnType<typeof slackClient>
  gmail: ReturnType<typeof gmailClient>
  anthropic: Anthropic
  model: string
  agentFiles: AgentFiles
  draftFiles: DraftFiles
  channel: string
  zaireSlackId: string
  slackToken: string
  openaiKey: string
  dryRun: boolean
  labelIds: Record<GmailGpsLabel, string> | null
}

async function messageText(rt: Runtime, message: SlackMessage): Promise<string> {
  const audio = message.files.find((f) => f.mimetype.startsWith('audio/'))
  if (!audio) return message.text
  const buffer = await downloadFile(audio.urlPrivate, rt.slackToken)
  const transcript = await transcribe(buffer, audio.name || 'memo.m4a', rt.openaiKey)
  return [message.text, transcript].filter(Boolean).join('\n')
}

function parserItems(rt: Runtime, digest: DigestRecord): ParserItem[] {
  return digest.items.map((item) => {
    const state = rt.store.get(item.threadId)
    const drafts = rt.store.draftsForThread(item.threadId)
    const draftStatus = drafts.some((d) => d.status === 'pending')
      ? 'pending' as const
      : drafts.some((d) => d.status === 'approved')
        ? 'approved' as const
        : 'none' as const
    return {
      number: item.number,
      line: state?.digestLine ?? state?.subject ?? item.threadId,
      section: item.section,
      threadId: item.threadId,
      draftStatus,
    }
  })
}

async function say(rt: Runtime, digestTs: string, text: string): Promise<string | null> {
  if (rt.dryRun) {
    console.log(`[dry-run] would post in thread ${digestTs}:\n${text}\n`)
    return null
  }
  return postThreadReply(rt.slack, rt.channel, digestTs, text)
}

async function makeDraft(
  rt: Runtime,
  digest: DigestRecord,
  action: MemoAction,
  threadId: string,
  prior?: DraftRecord,
): Promise<void> {
  if (threadId.startsWith('call:')) {
    // Call-ledger commitments have no Gmail thread to reply on.
    await say(
      rt,
      digest.slackTs,
      `That item is a call commitment with no email thread behind it — tell me who to email and what to say and I'll draft fresh.`,
    )
    return
  }
  const thread = await fetchThread(rt.gmail, threadId)
  const kind =
    action.verb === 'delegate' ? 'delegation' : action.verb === 'nudge' ? 'nudge' : 'reply'
  const instruction =
    action.verb === 'delegate'
      ? `Delegate to ${action.delegateTo ?? 'the named teammate'}: ${action.content}`
      : action.content ||
        (kind === 'nudge' ? 'Send the follow-up nudge for this thread.' : '')
  // Spec §6.2 retrieval — style precedent from the voice corpus when it exists.
  // Recipients: thread participants who aren't Zaire (exact-contact priority).
  const owner = optionalEnv('ZAIRE_EMAIL', '').toLowerCase()
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
    rt.anthropic,
    rt.model,
    {
      kind,
      thread,
      instruction,
      priorDraft: prior?.body,
      revision: prior ? action.content : undefined,
      examples,
    },
    rt.draftFiles,
  )
  const warnings = validateDraft(generated, { kind, thread, instruction })
  const post = buildDraftPost(generated, warnings)
  const ts = await say(rt, digest.slackTs, post)
  if (rt.dryRun) return
  if (prior) rt.store.setDraftStatus(prior.id, 'superseded')
  for (const stale of rt.store
    .draftsForThread(threadId)
    .filter((d) => d.status === 'pending')) {
    rt.store.setDraftStatus(stale.id, 'superseded')
  }
  rt.store.createDraft({
    threadId,
    kind,
    status: 'pending',
    body: generated.body,
    toAddr: generated.to,
    ccAddr: generated.cc || null,
    subject: generated.subject,
    headerLine: generated.headerLine,
    instruction,
    channel: rt.channel,
    slackTs: ts,
    digestSlackTs: digest.slackTs,
    itemNumber: action.itemNumber,
  })
}

async function executeAction(
  rt: Runtime,
  digest: DigestRecord,
  action: MemoAction,
): Promise<void> {
  if (action.verb === 'skip') return
  if (action.verb === 'clarify') {
    await say(rt, digest.slackTs, action.question ?? 'Which item did you mean?')
    return
  }
  const item = digest.items.find((i) => i.number === action.itemNumber)
  if (!item) {
    await say(
      rt,
      digest.slackTs,
      `Couldn't match "#${action.itemNumber ?? '?'}" to an item on this digest — which one did you mean?`,
    )
    return
  }
  const state = rt.store.get(item.threadId)

  switch (action.verb) {
    case 'snooze': {
      const until =
        action.snoozeUntil ??
        addBusinessDays(new Date(), 3).toISOString().slice(0, 10)
      if (!rt.dryRun && state) {
        rt.store.upsert({ ...state, snoozedUntil: until })
      }
      await say(rt, digest.slackTs, `Pushed #${item.number} — back on ${until}.`)
      return
    }
    case 'archive': {
      // Duplicate-action guard (spec §10).
      if (state?.label === 'Archive') {
        await say(rt, digest.slackTs, `#${item.number} already archived at ${state.updatedAt}.`)
        return
      }
      if (!rt.dryRun) {
        await applyGpsLabel(rt.gmail, item.threadId, 'Archive', rt.labelIds!)
        if (state) rt.store.upsert({ ...state, label: 'Archive', snoozedUntil: null })
      }
      await say(rt, digest.slackTs, `Archived #${item.number}.`)
      return
    }
    case 'approve': {
      const pending = rt.store
        .draftsForThread(item.threadId)
        .filter((d) => d.status === 'pending')
        .at(-1)
      if (!pending) {
        const approved = rt.store
          .draftsForThread(item.threadId)
          .filter((d) => d.status === 'approved')
          .at(-1)
        await say(
          rt,
          digest.slackTs,
          approved
            ? `#${item.number} already approved at ${approved.updatedAt} — draft is in Gmail.`
            : `#${item.number} has no pending draft to approve — tell me what to say and I'll draft it.`,
        )
        return
      }
      await finalizeApproval(rt, pending)
      return
    }
    case 'revise': {
      const prior = rt.store
        .draftsForThread(item.threadId)
        .filter((d) => d.status === 'pending')
        .at(-1)
      await makeDraft(rt, digest, action, item.threadId, prior)
      return
    }
    case 'nudge': {
      // Spec §5: "Nudge / Send the follow-up" approves the PRE-drafted nudge.
      const preDraft = rt.store
        .draftsForThread(item.threadId)
        .filter((d) => d.status === 'pending' && d.kind === 'nudge')
        .at(-1)
      if (preDraft) {
        await finalizeApproval(rt, preDraft)
        return
      }
      // No pre-draft (thread crossed threshold between scans) — draft one now.
      await makeDraft(rt, digest, action, item.threadId)
      return
    }
    case 'reply':
    case 'delegate': {
      // Duplicate-action guard (spec §10): don't double-draft a finished item.
      const approved = rt.store
        .draftsForThread(item.threadId)
        .filter((d) => d.status === 'approved')
        .at(-1)
      const pending = rt.store
        .draftsForThread(item.threadId)
        .some((d) => d.status === 'pending')
      if (approved && !pending) {
        await say(
          rt,
          digest.slackTs,
          `#${item.number} already handled at ${approved.updatedAt} — draft is in Gmail. Reply here with changes if you want it redone.`,
        )
        return
      }
      await makeDraft(rt, digest, action, item.threadId)
      return
    }
  }
}

async function finalizeApproval(rt: Runtime, draft: DraftRecord): Promise<void> {
  if (rt.dryRun) {
    console.log(`[dry-run] would finalize Gmail draft for thread ${draft.threadId}`)
    return
  }
  const thread = await fetchThread(rt.gmail, draft.threadId)
  const newest = thread.messages.at(-1)
  await createReplyDraft(rt.gmail, draft.threadId, {
    to: draft.toAddr ?? '',
    cc: draft.ccAddr ?? undefined,
    subject: draft.subject ?? `Re: ${thread.subject}`,
    body: draft.body,
    inReplyTo: newest?.rfcMessageId || undefined,
  })
  rt.store.setDraftStatus(draft.id, 'approved')
  // Spec §8: approving a nudge counts it. After 2, the thread escalates to
  // Flags and the engine never drafts a third. The waiting clock resets when
  // the sweep sees the sent nudge as the newest outbound.
  if (draft.kind === 'nudge') {
    const threadState = rt.store.get(draft.threadId)
    if (threadState) {
      rt.store.upsert({ ...threadState, nudgeCount: threadState.nudgeCount + 1 })
    }
  }
  await postThreadReply(
    rt.slack,
    rt.channel,
    draft.digestSlackTs ?? draft.slackTs ?? '',
    `Draft ready in Gmail — send when ready. (${draft.headerLine ?? draft.subject})`,
  )
}

async function run(dryRun: boolean): Promise<void> {
  const store = new StateStore(optionalEnv('STATE_DB_PATH', 'data/state.db'))
  const rt: Runtime = {
    store,
    slack: slackClient(requireEnv('SLACK_BOT_TOKEN')),
    gmail: gmailClient({
      clientId: requireEnv('GMAIL_CLIENT_ID'),
      clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
      refreshToken: requireEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
    }),
    anthropic: new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') }),
    model: optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-5'),
    agentFiles: loadAgentFiles(),
    draftFiles: loadDraftFiles(),
    channel: requireEnv('SLACK_INBOX_GPS_CHANNEL_ID'),
    zaireSlackId: requireEnv('ZAIRE_SLACK_USER_ID'),
    slackToken: requireEnv('SLACK_BOT_TOKEN'),
    openaiKey: requireEnv('OPENAI_API_KEY'),
    dryRun,
    labelIds: null,
  }
  if (!dryRun) rt.labelIds = await ensureGpsLabels(rt.gmail)

  const lookbackHours = Number(optionalEnv('INBOX_LOOKBACK_HOURS', '48'))
  const sinceIso = new Date(Date.now() - lookbackHours * 3_600_000).toISOString()
  const digests = store.digestsSince(sinceIso)
  let failures = 0

  for (const digest of digests) {
    try {
      const replies = await fetchReplies(rt.slack, rt.channel, digest.slackTs)

      // 1. Approvals: ✅ from Zaire on a pending draft post finalizes it (spec §7).
      for (const draft of store
        .draftsByStatus('pending')
        .filter((d) => d.digestSlackTs === digest.slackTs)) {
        const message = replies.find((m) => m.ts === draft.slackTs)
        const approved = APPROVE_EMOJI.some((emoji) =>
          (message?.reactions[emoji] ?? []).includes(rt.zaireSlackId),
        )
        if (approved) await finalizeApproval(rt, draft)
      }

      // 2. Instructions: new messages from Zaire in this digest thread.
      //    Hard rule 5 — nobody else's messages are ever parsed as instructions.
      const instructions = replies.filter(
        (m) =>
          m.user === rt.zaireSlackId &&
          m.ts !== digest.slackTs &&
          !store.isHandled(m.ts),
      )
      if (instructions.length === 0) continue

      const items = parserItems(rt, digest)
      let actions: MemoAction[] = []
      for (const message of instructions) {
        const text = await messageText(rt, message)
        if (!text.trim()) continue
        const response = await rt.anthropic.messages.create({
          model: rt.model,
          max_tokens: 1500,
          system: buildMemoSystemPrompt(rt.agentFiles, items, new Date()),
          messages: [{ role: 'user', content: text }],
        })
        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
        const parsed = parseActions(output)
        if (parsed.length === 0) {
          await say(
            rt,
            digest.slackTs,
            "Couldn't parse that into actions — mind restating? (item number + what to do)",
          )
        }
        actions = [...actions, ...parsed] // later messages append → later wins
      }

      for (const action of lastWinsPerItem(actions)) {
        await executeAction(rt, digest, action)
      }
      if (!dryRun) {
        for (const message of instructions) store.markHandled(message.ts)
      }
    } catch (error) {
      failures++
      console.error(`digest ${digest.slackTs} failed:`, error)
    }
  }

  // Top-level Zaire messages (not in a thread) answer the latest digest.
  // Messages the bot itself posted with a [voice] tag count as Zaire's too —
  // they can only originate from his authenticated voice session (v1.4 §5.4).
  const latest = digests[0]
  if (latest) {
    try {
      const oldest = (new Date(sinceIso).getTime() / 1000).toFixed(6)
      const topLevel = (await fetchHistory(rt.slack, rt.channel, oldest)).filter(
        (m) =>
          (m.user === rt.zaireSlackId ||
            (m.user === null && m.text.startsWith('[voice]'))) &&
          !m.threadTs &&
          !store.isHandled(m.ts),
      )
      for (const message of topLevel) {
        const text = await messageText(rt, message)
        if (!text.trim()) continue
        const response = await rt.anthropic.messages.create({
          model: rt.model,
          max_tokens: 1500,
          system: buildMemoSystemPrompt(rt.agentFiles, parserItems(rt, latest), new Date()),
          messages: [{ role: 'user', content: text }],
        })
        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
        for (const action of lastWinsPerItem(parseActions(output))) {
          await executeAction(rt, latest, action)
        }
        if (!dryRun) store.markHandled(message.ts)
      }
    } catch (error) {
      failures++
      console.error('top-level scan failed:', error)
    }
  }

  if (failures > 0) await postAlert(`inbox poll completed with ${failures} failures`)
  console.log(`inbox poll done${dryRun ? ' (dry-run)' : ''} — ${digests.length} digests checked`)
  store.close()
}

const isMain = process.argv[1]?.endsWith('memo.ts') || process.argv[1]?.endsWith('memo.js')
if (isMain) {
  run(process.argv.includes('--dry-run')).catch(async (error) => {
    console.error('[alert] inbox poll failed entirely:', error)
    await postAlert(`inbox poll failed: ${(error as Error).message}`)
    process.exit(1)
  })
}
