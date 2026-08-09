// create_draft (v1.4 spec §5.2) — a voice-dictated reply runs through the SAME
// machinery as the memo pipeline: generateDraft in Zaire's voice with corpus
// retrieval, the mechanical hard-rule validators, a Slack approval post, and a
// pending row in the shared drafts table. Voice cannot approve (spec §12) —
// the ✅ / "approve #" gate in #inbox-gps stays the only way to Gmail Drafts.

import Anthropic from '@anthropic-ai/sdk'
import { fetchThread, gmailClient } from '../../connectors/gmail.js'
import { postThreadReply, slackClient } from '../../connectors/slack.js'
import { buildDraftPost, generateDraft, loadDraftFiles, validateDraft } from '../../pipelines/draft.js'
import { retrieveForDraft } from '../../retrieval.js'
import { openState, requireVoiceEnv } from '../context.js'

export async function createDraft(args: Record<string, unknown>): Promise<string> {
  const instruction = String(args.instruction ?? '').trim()
  if (!instruction) throw new Error('tell me what the reply should say')

  const store = openState()
  if (!store) throw new Error('the inbox state database is not reachable from here')
  try {
    // Resolve the thread: digest item number preferred, raw thread id fallback.
    let threadId: string | null = null
    let itemNumber: number | null = null
    const latest = store.latestDigest()
    if (typeof args.digest_item_number === 'number') {
      itemNumber = args.digest_item_number
      threadId =
        latest?.items.find((i) => i.number === itemNumber)?.threadId ?? null
      if (!threadId) {
        return `I don't see a number ${itemNumber} on the latest digest — which thread did you mean?`
      }
    } else if (typeof args.thread_id === 'string' && args.thread_id) {
      threadId = args.thread_id
    } else {
      return 'Which digest item is this for? Give me the number from today\'s digest.'
    }
    if (threadId.startsWith('call:')) {
      return 'That item is a call commitment with no email thread behind it — tell me who to email and I\'ll flag it for a fresh draft in Slack.'
    }

    const gmail = gmailClient({
      clientId: requireVoiceEnv('GMAIL_CLIENT_ID'),
      clientSecret: requireVoiceEnv('GMAIL_CLIENT_SECRET'),
      refreshToken: requireVoiceEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
    })
    const thread = await fetchThread(gmail, threadId)

    const owner = (process.env.ZAIRE_EMAIL ?? '').toLowerCase()
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

    const anthropic = new Anthropic({ apiKey: requireVoiceEnv('ANTHROPIC_API_KEY') })
    const generated = await generateDraft(
      anthropic,
      process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
      { kind: 'reply', thread, instruction, examples },
      loadDraftFiles(),
    )
    const warnings = validateDraft(generated, { kind: 'reply', thread, instruction })

    // Post into the approval gate. Prefer the latest digest thread so the memo
    // poller's ✅ scan sees it; anchor a fresh thread if no digest exists yet.
    const channel = requireVoiceEnv('SLACK_INBOX_GPS_CHANNEL_ID')
    const slack = slackClient(requireVoiceEnv('SLACK_BOT_TOKEN'))
    let digestTs = latest?.slackTs ?? null
    if (!digestTs) {
      const { postMessage } = await import('../../connectors/slack.js')
      digestTs = await postMessage(slack, channel, '*Voice drafts* — approvals thread')
      store.saveDigest(channel, digestTs, [])
    }
    const draftTs = await postThreadReply(
      slack,
      channel,
      digestTs,
      `_[voice-dictated]_\n${buildDraftPost(generated, warnings)}`,
    )
    store.createDraft({
      threadId,
      kind: 'reply',
      status: 'pending',
      body: generated.body,
      toAddr: generated.to,
      ccAddr: generated.cc || null,
      subject: generated.subject,
      headerLine: generated.headerLine,
      instruction,
      warnings,
      channel,
      slackTs: draftTs,
      digestSlackTs: digestTs,
      itemNumber,
    })

    const caveat = warnings.length > 0 ? ' Heads up: it has a validator warning to look at.' : ''
    return `Draft ready for "${thread.subject}". It's pending your approval in Slack — check the #inbox-gps thread.${caveat}`
  } finally {
    store.close()
  }
}
