// Gmail connector — draft-only mailbox access (spec §2, CLAUDE.md constraint 1).
//
// Google's scope granularity cannot express "labels + archive + drafts but not send":
// the narrowest scope covering what v1 needs is gmail.modify, which technically permits
// sending at the API level. The no-send / no-delete rule is therefore enforced
// STRUCTURALLY here — this module exposes no send or delete code path, and
// tests/gmail-guard.test.ts fails the build if one is ever added.

import { google, type gmail_v1 } from 'googleapis'

export const GPS_LABELS = ['1-Respond', '2-Review', '3-Waiting'] as const
export type GmailGpsLabel = (typeof GPS_LABELS)[number]

export interface GmailCredentials {
  clientId: string
  clientSecret: string
  refreshToken: string
}

export interface MessageSummary {
  id: string
  from: string
  to: string
  cc: string
  date: string
  /** RFC 2822 Message-ID header — threading anchor for reply drafts. */
  rfcMessageId: string
  body: string
  attachments: string[]
}

export interface ThreadSummary {
  id: string
  subject: string
  messages: MessageSummary[] // oldest first; newest is last
}

export function gmailClient(creds: GmailCredentials): gmail_v1.Gmail {
  const auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret)
  auth.setCredentials({ refresh_token: creds.refreshToken })
  return google.gmail({ version: 'v1', auth })
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const status = (error as { status?: number; code?: number }).status
        ?? (error as { code?: number }).code
      const retryable = status === 429 || (typeof status === 'number' && status >= 500)
      if (!retryable || i === attempts - 1) throw error
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i))
    }
  }
  throw lastError
}

/** Create the three GPS labels if missing; return name → Gmail label ID. */
export async function ensureGpsLabels(
  gmail: gmail_v1.Gmail,
): Promise<Record<GmailGpsLabel, string>> {
  const res = await withRetry(() => gmail.users.labels.list({ userId: 'me' }))
  const existing = new Map(
    (res.data.labels ?? []).map((l) => [l.name ?? '', l.id ?? '']),
  )
  const ids = {} as Record<GmailGpsLabel, string>
  for (const name of GPS_LABELS) {
    let id = existing.get(name)
    if (!id) {
      const created = await withRetry(() =>
        gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        }),
      )
      id = created.data.id ?? ''
    }
    ids[name] = id
  }
  return ids
}

/**
 * Labels are mutually exclusive (spec §3): applying one GPS label removes the
 * other two. 'Archive' is not a Gmail label — archiving removes INBOX and any
 * GPS labels; the thread stays searchable forever.
 */
export function buildLabelChange(
  target: GmailGpsLabel | 'Archive',
  labelIds: Record<GmailGpsLabel, string>,
): { addLabelIds: string[]; removeLabelIds: string[] } {
  if (target === 'Archive') {
    return {
      addLabelIds: [],
      removeLabelIds: ['INBOX', ...GPS_LABELS.map((l) => labelIds[l])],
    }
  }
  return {
    addLabelIds: [labelIds[target]],
    removeLabelIds: GPS_LABELS.filter((l) => l !== target).map((l) => labelIds[l]),
  }
}

export async function applyGpsLabel(
  gmail: gmail_v1.Gmail,
  threadId: string,
  target: GmailGpsLabel | 'Archive',
  labelIds: Record<GmailGpsLabel, string>,
): Promise<void> {
  await withRetry(() =>
    gmail.users.threads.modify({
      userId: 'me',
      id: threadId,
      requestBody: buildLabelChange(target, labelIds),
    }),
  )
}

export async function listInboxThreadIds(
  gmail: gmail_v1.Gmail,
  max = 100,
): Promise<string[]> {
  const res = await withRetry(() =>
    gmail.users.threads.list({ userId: 'me', q: 'in:inbox', maxResults: max }),
  )
  return (res.data.threads ?? []).flatMap((t) => (t.id ? [t.id] : []))
}

function header(message: gmail_v1.Schema$Message, name: string): string {
  const headers = message.payload?.headers ?? []
  return headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
}

function decodeBody(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8')
}

function extractText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeBody(part.body.data)
  for (const child of part.parts ?? []) {
    const text = extractText(child)
    if (text) return text
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decodeBody(part.body.data)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
  }
  return ''
}

function listAttachments(part: gmail_v1.Schema$MessagePart | undefined): string[] {
  if (!part) return []
  const own = part.filename && part.body?.attachmentId ? [part.filename] : []
  return [...own, ...(part.parts ?? []).flatMap(listAttachments)]
}

export async function fetchThread(
  gmail: gmail_v1.Gmail,
  threadId: string,
): Promise<ThreadSummary> {
  const res = await withRetry(() =>
    gmail.users.threads.get({ userId: 'me', id: threadId, format: 'full' }),
  )
  const messages = (res.data.messages ?? []).map((m) => ({
    id: m.id ?? '',
    from: header(m, 'From'),
    to: header(m, 'To'),
    cc: header(m, 'Cc'),
    date: header(m, 'Date'),
    rfcMessageId: header(m, 'Message-ID'),
    body: extractText(m.payload).trim().slice(0, 1500),
    attachments: listAttachments(m.payload),
  }))
  const first = res.data.messages?.[0]
  return {
    id: threadId,
    subject: first ? header(first, 'Subject') : '',
    messages,
  }
}

/** List message ids matching a Gmail query (paginated), e.g. the Sent folder. */
export async function listMessageIds(
  gmail: gmail_v1.Gmail,
  query: string,
  max: number,
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined
  while (ids.length < max) {
    const res = await withRetry(() =>
      gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(500, max - ids.length),
        pageToken,
      }),
    )
    ids.push(...(res.data.messages ?? []).flatMap((m) => (m.id ? [m.id] : [])))
    pageToken = res.data.nextPageToken ?? undefined
    if (!pageToken) break
  }
  return ids.slice(0, max)
}

export interface FetchedMessage extends MessageSummary {
  threadId: string
  subject: string
}

export async function fetchMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<FetchedMessage> {
  const res = await withRetry(() =>
    gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' }),
  )
  const m = res.data
  return {
    id: m.id ?? '',
    threadId: m.threadId ?? '',
    subject: header(m, 'Subject'),
    from: header(m, 'From'),
    to: header(m, 'To'),
    cc: header(m, 'Cc'),
    date: header(m, 'Date'),
    rfcMessageId: header(m, 'Message-ID'),
    body: extractText(m.payload).trim().slice(0, 4000),
    attachments: listAttachments(m.payload),
  }
}

export interface ReplyDraftOptions {
  to: string
  cc?: string
  subject: string
  body: string
  /** Message-ID of the message being replied to — keeps Gmail threading intact. */
  inReplyTo?: string
}

/** Plain-text RFC 2822 message, base64url-encoded for the Gmail API. */
export function buildReplyMime(opts: ReplyDraftOptions): string {
  const headers = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : null,
    `Subject: ${opts.subject}`,
    opts.inReplyTo ? `In-Reply-To: ${opts.inReplyTo}` : null,
    opts.inReplyTo ? `References: ${opts.inReplyTo}` : null,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ].filter((h): h is string => h !== null)
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${opts.body}`, 'utf8').toString(
    'base64url',
  )
}

/**
 * A fresh (non-reply) draft — call-derived follow-ups and delegation notes that
 * have no existing Gmail thread. Same rule as everywhere: drafts only, the
 * human click to send is the final control.
 */
export async function createDraftMessage(
  gmail: gmail_v1.Gmail,
  opts: ReplyDraftOptions,
): Promise<string> {
  const res = await withRetry(() =>
    gmail.users.drafts.create({
      userId: 'me',
      requestBody: { message: { raw: buildReplyMime(opts) } },
    }),
  )
  return res.data.id ?? ''
}

/**
 * The approval gate's terminal action (spec §7.3): finalize an approved draft in
 * Gmail Drafts, attached to the correct thread. Creating a draft is the ONLY
 * outbound capability this connector has — the human click to send is the final
 * control.
 */
export async function createReplyDraft(
  gmail: gmail_v1.Gmail,
  threadId: string,
  opts: ReplyDraftOptions,
): Promise<string> {
  const res = await withRetry(() =>
    gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: {
          threadId,
          raw: buildReplyMime(opts),
        },
      },
    }),
  )
  return res.data.id ?? ''
}
