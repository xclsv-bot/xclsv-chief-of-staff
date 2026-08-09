// Slack connector — the #inbox-gps bot (spec §2). Digests are top-level
// messages; drafts (stage 4) and nudges (stage 6) are threaded replies under
// their digest item. Approvals arrive as emoji reactions — reading those is
// wired up in stage 4 with the voice pipeline.

import { WebClient } from '@slack/web-api'

export function slackClient(token: string): WebClient {
  return new WebClient(token)
}

/** Post a top-level message; returns its ts (the thread anchor). */
export async function postMessage(
  client: WebClient,
  channel: string,
  text: string,
): Promise<string> {
  const res = await client.chat.postMessage({
    channel,
    text,
    unfurl_links: false,
    unfurl_media: false,
  })
  if (!res.ts) throw new Error('Slack postMessage returned no ts')
  return res.ts
}

export async function postThreadReply(
  client: WebClient,
  channel: string,
  threadTs: string,
  text: string,
): Promise<string> {
  const res = await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text,
    unfurl_links: false,
    unfurl_media: false,
  })
  if (!res.ts) throw new Error('Slack postMessage returned no ts')
  return res.ts
}

/**
 * One alert line for pipeline failures (spec §10: never fail silently).
 * Best-effort — an alert about a failure must not itself crash the sweep.
 */
export async function postAlert(text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  const channel = process.env.SLACK_INBOX_GPS_CHANNEL_ID
  if (!token || !channel) {
    console.error(`[alert] (Slack not configured) ${text}`)
    return
  }
  try {
    await postMessage(slackClient(token), channel, `:warning: ${text}`)
  } catch (error) {
    console.error(`[alert] (Slack post failed) ${text}`, error)
  }
}
