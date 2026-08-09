// send_slack_note (v1.4 spec §5.4) — drops an async instruction into
// #inbox-gps for the memo pipeline's next run, tagged [voice] so the poller
// treats it as Zaire's instruction (the voice session is authenticated as him)
// and the trace is visible in the channel.

import { postMessage, slackClient } from '../../connectors/slack.js'
import { requireVoiceEnv } from '../context.js'

export async function sendSlackNote(args: Record<string, unknown>): Promise<string> {
  const message = String(args.message ?? '').trim()
  if (!message) throw new Error('tell me what the note should say')
  await postMessage(
    slackClient(requireVoiceEnv('SLACK_BOT_TOKEN')),
    requireVoiceEnv('SLACK_INBOX_GPS_CHANNEL_ID'),
    `[voice] ${message}`,
  )
  return 'Sent to #inbox-gps. The text pipeline picks it up on its next run.'
}
