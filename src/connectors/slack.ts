// Slack connector — the #inbox-gps bot (spec §2). Digests are top-level
// messages; drafts (stage 4) and nudges (stage 6) are threaded replies under
// their digest item. Approvals arrive as emoji reactions — reading those is
// wired up in stage 4 with the voice pipeline.

import { WebClient } from '@slack/web-api'

export function slackClient(token: string): WebClient {
  return new WebClient(token)
}

export interface SlackFileRef {
  id: string
  name: string
  mimetype: string
  urlPrivate: string
}

export interface SlackMessage {
  ts: string
  threadTs: string | null
  user: string | null
  text: string
  files: SlackFileRef[]
  /** emoji name → user IDs who reacted */
  reactions: Record<string, string[]>
}

interface RawMessage {
  ts?: string
  thread_ts?: string
  user?: string
  bot_id?: string
  text?: string
  files?: { id?: string; name?: string; mimetype?: string; url_private?: string }[]
  reactions?: { name?: string; users?: string[] }[]
}

function toMessage(raw: RawMessage): SlackMessage {
  return {
    ts: raw.ts ?? '',
    threadTs: raw.thread_ts ?? null,
    user: raw.user ?? null,
    text: raw.text ?? '',
    files: (raw.files ?? []).map((f) => ({
      id: f.id ?? '',
      name: f.name ?? '',
      mimetype: f.mimetype ?? '',
      urlPrivate: f.url_private ?? '',
    })),
    reactions: Object.fromEntries(
      (raw.reactions ?? []).map((r) => [r.name ?? '', r.users ?? []]),
    ),
  }
}

export async function fetchHistory(
  client: WebClient,
  channel: string,
  oldestTs: string,
): Promise<SlackMessage[]> {
  const res = await client.conversations.history({ channel, oldest: oldestTs, limit: 200 })
  return ((res.messages ?? []) as RawMessage[]).map(toMessage).sort((a, b) =>
    a.ts.localeCompare(b.ts),
  )
}

export async function fetchReplies(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<SlackMessage[]> {
  const res = await client.conversations.replies({ channel, ts: threadTs, limit: 200 })
  return ((res.messages ?? []) as RawMessage[]).map(toMessage).sort((a, b) =>
    a.ts.localeCompare(b.ts),
  )
}

/** Download a Slack file (voice note) — needs the files:read bot scope. */
export async function downloadFile(urlPrivate: string, token: string): Promise<Buffer> {
  const res = await fetch(urlPrivate, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
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
