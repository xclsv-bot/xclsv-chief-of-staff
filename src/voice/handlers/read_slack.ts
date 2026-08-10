// read_slack — speaks the recent #inbox-gps activity: who said what, compact,
// newest last. Names resolved via users:read where possible; never reads raw
// user IDs, links, or markdown aloud (voice-conduct.md).

import {
  fetchHistory,
  getUserName,
  slackClient,
  type SlackMessage,
} from '../../connectors/slack.js'
import { requireVoiceEnv } from '../context.js'

function cleanForSpeech(text: string): string {
  return text
    .replace(/<https?:[^|>]*\|([^>]+)>/g, '$1') // <url|label> → label
    .replace(/<https?:[^>]*>/g, 'a link')
    .replace(/<[#@][^>]+>/g, 'someone')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function formatSpokenSlack(
  messages: { name: string; text: string }[],
): string {
  if (messages.length === 0) {
    return 'The channel has been quiet — nothing new in the last day.'
  }
  const lines = messages.map((m) => `${m.name}: ${m.text}`)
  return `Latest in the channel, oldest first. ${lines.join('. Next, ')}.`
}

export async function readSlack(args: Record<string, unknown>): Promise<string> {
  const max = Math.min(Math.max(Number(args.max_messages ?? 6) || 6, 1), 10)
  const client = slackClient(requireVoiceEnv('SLACK_BOT_TOKEN'))
  const channel = requireVoiceEnv('SLACK_INBOX_GPS_CHANNEL_ID')
  const oldest = ((Date.now() - 24 * 3_600_000) / 1000).toFixed(6)

  const history = await fetchHistory(client, channel, oldest)
  const recent = history.filter((m) => m.text.trim()).slice(-max)

  const nameCache = new Map<string, string>()
  const resolved: { name: string; text: string }[] = []
  for (const message of recent as SlackMessage[]) {
    let name = 'Arya' // bot-authored (digests, drafts) have no user id
    if (message.user) {
      if (!nameCache.has(message.user)) {
        nameCache.set(message.user, (await getUserName(client, message.user)) ?? 'someone')
      }
      name = nameCache.get(message.user)!
    }
    resolved.push({ name, text: cleanForSpeech(message.text) })
  }
  return formatSpokenSlack(resolved)
}
