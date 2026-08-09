// Voice corpus builder — spec §6.1. One-time build, then refreshed monthly.
//
// Sources: Zaire's Gmail Sent folder (trailing 12 months) and Slack history from
// channels he designates (SLACK_CORPUS_CHANNEL_IDS). Exclusions from
// agent/corpus-exclusions.md are applied at ingest — excluded material never
// touches disk. Output lands under gitignored data/:
//   data/corpus/emails.jsonl        the email corpus, situation-tagged
//   data/corpus/slack.jsonl         Zaire's Slack register
//   data/embeddings/emails.json     id → embedding vector (retrieval index)
//   data/writing-profile.generated.md CANDIDATE profile — Zaire reviews and
//                                     promotes to agent/writing-profile.md himself.
//
// Privacy: corpus records are real correspondence. This pipeline logs counts and
// file paths only — never message contents (CLAUDE.md architecture rules).

import Anthropic from '@anthropic-ai/sdk'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { optionalEnv, requireEnv } from '../config.js'
import {
  fetchMessage,
  gmailClient,
  listMessageIds,
  type FetchedMessage,
} from '../connectors/gmail.js'
import { fetchAllHistory, slackClient } from '../connectors/slack.js'
import {
  CORPUS_EMAILS_PATH,
  EMBEDDINGS_PATH,
  embedTexts,
  isExcluded,
  parseExclusions,
  type CorpusEmail,
} from '../retrieval.js'

export const SITUATIONS = [
  'established_partner',
  'new_contact',
  'internal_team',
  'nudge_follow_up',
  'scheduling',
  'declining_deferring',
  'other',
] as const

export function toCorpusEmail(m: FetchedMessage, situation?: string): CorpusEmail {
  return {
    id: m.id,
    threadId: m.threadId,
    date: Number.isNaN(Date.parse(m.date)) ? '' : new Date(m.date).toISOString(),
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    body: m.body,
    situation,
  }
}

/** Batch-classify sent emails into spec §6.1 situation clusters. */
async function classifySituations(
  client: Anthropic,
  model: string,
  emails: CorpusEmail[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (let i = 0; i < emails.length; i += 20) {
    const batch = emails.slice(i, i + 20)
    const rendered = batch
      .map(
        (e) =>
          `id: ${e.id}\nto: ${e.to}\nsubject: ${e.subject}\nexcerpt: ${e.body.slice(0, 300)}`,
      )
      .join('\n===\n')
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      system: [
        'Classify each of these emails ZAIRE WILLIAMS sent into exactly one situation',
        `cluster: ${SITUATIONS.join(', ')}.`,
        'internal_team = to an @xclsvmedia.com teammate. nudge_follow_up = chasing a',
        'quiet thread. declining_deferring = saying no or punting a decision.',
        'Respond ONLY with JSON: {"labels": {"<id>": "<situation>", ...}}',
      ].join('\n'),
      messages: [{ role: 'user', content: rendered }],
    })
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    try {
      const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
        labels?: Record<string, string>
      }
      for (const [id, label] of Object.entries(parsed.labels ?? {})) {
        if ((SITUATIONS as readonly string[]).includes(label)) result.set(id, label)
      }
    } catch {
      // Unclassified emails stay situation-less; retrieval still works on them.
    }
    console.log(`classified ${Math.min(i + 20, emails.length)}/${emails.length}`)
  }
  return result
}

/** Distill the candidate voice profile (spec §6.1) from cluster samples. */
async function distillProfile(
  client: Anthropic,
  model: string,
  emails: CorpusEmail[],
): Promise<string> {
  const sections: string[] = []
  for (const situation of SITUATIONS) {
    const samples = emails
      .filter((e) => e.situation === situation)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 25)
    if (samples.length === 0) continue
    const rendered = samples
      .map((e) => `Subject: ${e.subject}\nTo: ${e.to}\n${e.body.slice(0, 1200)}`)
      .join('\n===\n')
    const response = await client.messages.create({
      model,
      max_tokens: 1200,
      system: [
        `You are distilling how Zaire Williams writes in the "${situation}" situation,`,
        'from real emails he sent. Describe, concretely and briefly (markdown, no',
        'preamble): observed greeting/closing norms; typical length; formality level;',
        'characteristic phrasings (quote them); and how he actually handles this',
        'situation (how he says no, how he chases, how he defers a number).',
        'Describe the style — do NOT reproduce facts, figures, names of deals, or',
        'commitments from the emails.',
      ].join('\n'),
      messages: [{ role: 'user', content: rendered }],
    })
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    sections.push(`## ${situation.replace(/_/g, ' ')} (${samples.length} samples)\n\n${text}`)
    console.log(`distilled: ${situation} (${samples.length} samples)`)
  }
  return [
    '# writing-profile.md — GENERATED CANDIDATE',
    '',
    `> Generated ${new Date().toISOString().slice(0, 10)} from ${emails.length} sent`,
    '> emails. REVIEW BEFORE PROMOTING: read it, edit it, then copy it to',
    '> `agent/writing-profile.md` yourself. Only Zaire promotes this file (CLAUDE.md).',
    '> Keep the "Corpus rules" section from the current agent/writing-profile.md.',
    '',
    ...sections,
  ].join('\n\n')
}

async function run(dryRun: boolean): Promise<void> {
  const exclusions = parseExclusions(readFileSync('agent/corpus-exclusions.md', 'utf8'))
  console.log(
    `exclusions loaded: ${exclusions.contacts.length} contacts, ${exclusions.keywords.length} keywords`,
  )
  const gmail = gmailClient({
    clientId: requireEnv('GMAIL_CLIENT_ID'),
    clientSecret: requireEnv('GMAIL_CLIENT_SECRET'),
    refreshToken: requireEnv('GMAIL_ZAIRE_REFRESH_TOKEN'),
  })
  const anthropic = new Anthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
  const classifyModel = optionalEnv('ANTHROPIC_CLASSIFY_MODEL', 'claude-haiku-4-5-20251001')
  const distillModel = optionalEnv('ANTHROPIC_MODEL', 'claude-sonnet-5')
  const maxEmails = Number(optionalEnv('CORPUS_MAX_EMAILS', '2000'))
  const windowDays = Number(optionalEnv('CORPUS_WINDOW_DAYS', '365'))
  console.log(`corpus window: ${windowDays} days`)

  // 1. Sent mail, trailing window (default 12 months; shorter windows for
  //    incremental / first-pass builds — spec §6.1 refresh cadence).
  const ids = await listMessageIds(gmail, `in:sent newer_than:${windowDays}d`, maxEmails)
  console.log(`sent messages found: ${ids.length}`)
  const kept: CorpusEmail[] = []
  let excluded = 0
  for (const [index, id] of ids.entries()) {
    const message = await fetchMessage(gmail, id)
    if (!message.body.trim()) continue
    if (isExcluded(message, exclusions)) {
      excluded++
      continue
    }
    kept.push(toCorpusEmail(message))
    if ((index + 1) % 100 === 0) console.log(`fetched ${index + 1}/${ids.length}`)
  }
  console.log(`corpus emails kept: ${kept.length} (excluded: ${excluded})`)

  if (dryRun) {
    console.log('[dry-run] stopping before classification/embedding/writes')
    return
  }
  mkdirSync('data/corpus', { recursive: true })
  mkdirSync('data/embeddings', { recursive: true })

  // 2. Situation clusters.
  const labels = await classifySituations(anthropic, classifyModel, kept)
  for (const email of kept) email.situation = labels.get(email.id) ?? 'other'
  writeFileSync(
    CORPUS_EMAILS_PATH,
    kept.map((e) => JSON.stringify(e)).join('\n') + '\n',
  )
  console.log(`wrote ${CORPUS_EMAILS_PATH} (${kept.length} records)`)

  // 3. Slack register (optional channels Zaire designates).
  const channelIds = optionalEnv('SLACK_CORPUS_CHANNEL_IDS', '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
  if (channelIds.length > 0) {
    const slack = slackClient(requireEnv('SLACK_BOT_TOKEN'))
    const zaireId = requireEnv('ZAIRE_SLACK_USER_ID')
    const oldest = ((Date.now() - windowDays * 86_400_000) / 1000).toFixed(6)
    const lines: string[] = []
    for (const channel of channelIds) {
      const messages = await fetchAllHistory(slack, channel, oldest)
      const mine = messages.filter(
        (m) =>
          m.user === zaireId &&
          m.text.trim() &&
          !isExcluded({ to: '', cc: '', subject: '', body: m.text }, exclusions),
      )
      lines.push(
        ...mine.map((m) => JSON.stringify({ channel, ts: m.ts, text: m.text })),
      )
      console.log(`slack channel ${channel}: ${mine.length} messages kept`)
    }
    writeFileSync('data/corpus/slack.jsonl', lines.join('\n') + '\n')
  } else {
    console.log('SLACK_CORPUS_CHANNEL_IDS unset — skipping Slack register')
  }

  // 4. Embedding index for retrieval.
  const openaiKey = requireEnv('OPENAI_API_KEY')
  const vectors = await embedTexts(
    kept.map((e) => `${e.subject}\n${e.body}`),
    openaiKey,
    optionalEnv('EMBEDDING_MODEL', 'text-embedding-3-small'),
  )
  const index = Object.fromEntries(kept.map((e, i) => [e.id, vectors[i] ?? []]))
  writeFileSync(EMBEDDINGS_PATH, JSON.stringify(index))
  console.log(`wrote ${EMBEDDINGS_PATH} (${vectors.length} vectors)`)

  // 5. Candidate profile — Zaire promotes it manually after review.
  const profile = await distillProfile(anthropic, distillModel, kept)
  writeFileSync('data/writing-profile.generated.md', profile)
  console.log(
    'wrote data/writing-profile.generated.md — review it, then promote to agent/writing-profile.md yourself',
  )
}

const isMain =
  process.argv[1]?.endsWith('corpus_builder.ts') ||
  process.argv[1]?.endsWith('corpus_builder.js')
if (isMain) {
  run(process.argv.includes('--dry-run')).catch((error) => {
    console.error('[alert] corpus build failed:', error)
    process.exit(1)
  })
}
