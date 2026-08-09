// search_email (v1.4 spec §5.5) — read-only Gmail search, spoken back as a
// short numbered summary with a one-sentence extract per thread.

import { fetchThread, gmailClient, searchThreadIds } from '../../connectors/gmail.js'
import { requireVoiceEnv } from '../context.js'

function speakableDate(raw: string): string {
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export async function searchEmail(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? '').trim()
  if (!query) throw new Error('give me something to search for')
  const max = Math.min(Math.max(Number(args.max_results ?? 5) || 5, 1), 10)

  const gmail = gmailClient({
    clientId: requireVoiceEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireVoiceEnv('GMAIL_CLIENT_SECRET'),
    refreshToken: requireVoiceEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
  })
  const ids = await searchThreadIds(gmail, query, max)
  if (ids.length === 0) return `Nothing in Gmail matches "${query}".`

  const lines: string[] = []
  for (const [index, id] of ids.entries()) {
    const thread = await fetchThread(gmail, id)
    const newest = thread.messages.at(-1)
    const from = newest?.from.replace(/<[^>]*>/g, '').trim() || 'Unknown sender'
    const date = newest ? speakableDate(newest.date) : ''
    const extract = newest?.body.replace(/\s+/g, ' ').slice(0, 140) ?? ''
    lines.push(
      `${index + 1}: ${from}${date ? `, ${date}` : ''}, subject "${thread.subject}". ${extract}`,
    )
  }
  return `${ids.length === 1 ? 'One thread matches' : `${ids.length} threads match`}. ${lines.join(' ')}`
}
