// search_email (v1.4 spec §5.5) — read-only Gmail search, spoken back as a
// short numbered summary with a one-sentence extract per thread.
//
// Recency: Gmail's relative filters bottom out at days (newer_than:1d) —
// "newer_than:1h" is silently treated as junk and matches NOTHING, which made
// Arya report "no emails in the last hour" while important mail sat in the
// inbox (live feedback, 2026-08-10). since_hours converts to Gmail's epoch
// after: filter, which is precise to the second.

import { fetchThread, gmailClient, searchThreadIds } from '../../connectors/gmail.js'
import { requireVoiceEnv } from '../context.js'

/** Build the effective Gmail query; pure for tests. */
export function buildGmailQuery(
  query: string,
  sinceHours: number | null,
  nowMs: number,
): string {
  const base = query.trim() || 'in:inbox'
  if (!sinceHours || sinceHours <= 0) return base
  const epochSeconds = Math.floor((nowMs - sinceHours * 3_600_000) / 1000)
  return `${base} after:${epochSeconds}`
}

function speakableDate(raw: string, nowMs: number): string {
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  const ageMs = nowMs - parsed.getTime()
  if (ageMs < 48 * 3_600_000) {
    // Recent mail: the time matters more than the date.
    const time = parsed.toLocaleTimeString('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: '2-digit',
    })
    return ageMs < 60_000 ? 'just now' : `${time}${ageMs > 24 * 3_600_000 ? ' yesterday' : ''}`
  }
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export async function searchEmail(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  const sinceHours =
    typeof args.since_hours === 'number' && args.since_hours > 0
      ? args.since_hours
      : null
  if (!query && !sinceHours) throw new Error('give me something to search for')
  const max = Math.min(Math.max(Number(args.max_results ?? 5) || 5, 1), 10)
  const effectiveQuery = buildGmailQuery(query, sinceHours, Date.now())

  const gmail = gmailClient({
    clientId: requireVoiceEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireVoiceEnv('GMAIL_CLIENT_SECRET'),
    refreshToken: requireVoiceEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
  })
  const ids = await searchThreadIds(gmail, effectiveQuery, max)
  if (ids.length === 0) {
    return sinceHours
      ? `Nothing new in the inbox in the last ${sinceHours === 1 ? 'hour' : `${sinceHours} hours`}${query ? ` matching "${query}"` : ''}.`
      : `Nothing in Gmail matches "${query}".`
  }

  const lines: string[] = []
  for (const [index, id] of ids.entries()) {
    const thread = await fetchThread(gmail, id)
    const newest = thread.messages.at(-1)
    const from = newest?.from.replace(/<[^>]*>/g, '').trim() || 'Unknown sender'
    const date = newest ? speakableDate(newest.date, Date.now()) : ''
    const extract = newest?.body.replace(/\s+/g, ' ').slice(0, 140) ?? ''
    lines.push(
      `${index + 1}: ${from}${date ? `, ${date}` : ''}, subject "${thread.subject}". ${extract}`,
    )
  }
  return `${ids.length === 1 ? 'One thread matches' : `${ids.length} threads match`}. ${lines.join(' ')}`
}
