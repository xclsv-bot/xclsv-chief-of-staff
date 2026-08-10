// send_slack_message — posts to #inbox-gps as the Arya bot, on Zaire's spoken
// instruction. Unlike the retired send_slack_note (which fed the deleted memo
// pipeline a machine tag), this is a plain post for humans to read; the bot
// authorship is the provenance, and the voice_tool_calls log keeps the trace.

import { postMessage, slackClient } from '../../connectors/slack.js'
import { requireVoiceEnv } from '../context.js'

export async function sendSlackMessage(args: Record<string, unknown>): Promise<string> {
  const message = String(args.message ?? '').trim()
  if (!message) throw new Error('tell me what the message should say')
  await postMessage(
    slackClient(requireVoiceEnv('SLACK_BOT_TOKEN')),
    requireVoiceEnv('SLACK_INBOX_GPS_CHANNEL_ID'),
    message,
  )
  return 'Posted to the channel.'
}
