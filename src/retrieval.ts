// Voice-corpus retrieval (spec §6.2). Priority order at draft time:
//   (1) Zaire's past emails to this exact contact — ground truth for that
//       relationship's tone;
//   (2) semantically similar past emails (same situation type);
//   (3) voice-profile.md — already in the draft prompt as the fallback.
// Retrieved examples condition STYLE only; the numbers-rule validator in
// draft.ts remains the mechanical backstop against content leaking through.
//
// Privacy: corpus records are real correspondence. Nothing in this module may
// log message contents — counts and ids only.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CorpusEmail {
  id: string
  threadId: string
  date: string
  to: string
  cc: string
  subject: string
  body: string
  situation?: string
}

export interface Exclusions {
  contacts: string[]
  keywords: string[]
}

/** Parse agent/corpus-exclusions.md — "- item" lines under the two sections. */
export function parseExclusions(markdown: string): Exclusions {
  const result: Exclusions = { contacts: [], keywords: [] }
  let section: keyof Exclusions | null = null
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.*)/)?.[1]?.toLowerCase()
    if (heading) {
      section = heading.includes('contact')
        ? 'contacts'
        : heading.includes('keyword')
          ? 'keywords'
          : null
      continue
    }
    const item = line.match(/^-\s+(.+)/)?.[1]?.trim().toLowerCase()
    if (item && section && !item.startsWith('(')) result[section].push(item)
  }
  return result
}

export function isExcluded(
  email: Pick<CorpusEmail, 'to' | 'cc' | 'subject' | 'body'>,
  exclusions: Exclusions,
): boolean {
  const addresses = `${email.to} ${email.cc}`.toLowerCase()
  if (exclusions.contacts.some((c) => addresses.includes(c))) return true
  const content = `${email.subject}\n${email.body}`.toLowerCase()
  return exclusions.keywords.some((k) => content.includes(k))
}

// ── Embeddings ──────────────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
    normA += (a[i] ?? 0) ** 2
    normB += (b[i] ?? 0) ** 2
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0
}

/** OpenAI embeddings, batched. Returns one vector per input, same order. */
export async function embedTexts(
  texts: string[],
  apiKey: string,
  model = 'text-embedding-3-small',
): Promise<number[][]> {
  const vectors: number[][] = []
  for (let i = 0; i < texts.length; i += 100) {
    const batch = texts.slice(i, i + 100).map((t) => t.slice(0, 8000))
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model, input: batch }),
    })
    if (!res.ok) throw new Error(`embedding failed: ${res.status}`)
    const data = (await res.json()) as { data: { index: number; embedding: number[] }[] }
    for (const item of [...data.data].sort((a, b) => a.index - b.index)) {
      vectors.push(item.embedding)
    }
  }
  return vectors
}

// ── Corpus files ────────────────────────────────────────────────────────────

export const CORPUS_EMAILS_PATH = 'data/corpus/emails.jsonl'
export const EMBEDDINGS_PATH = 'data/embeddings/emails.json'

export function corpusExists(root = '.'): boolean {
  return existsSync(join(root, CORPUS_EMAILS_PATH))
}

export function loadCorpus(root = '.'): CorpusEmail[] {
  return readFileSync(join(root, CORPUS_EMAILS_PATH), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusEmail)
}

export function loadEmbeddings(root = '.'): Record<string, number[]> {
  const path = join(root, EMBEDDINGS_PATH)
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, number[]>
}

// ── Retrieval ───────────────────────────────────────────────────────────────

/** Priority 1: most recent emails Zaire sent to any of these exact addresses. */
export function retrieveByContact(
  corpus: CorpusEmail[],
  recipientEmails: string[],
  k = 3,
): CorpusEmail[] {
  const targets = recipientEmails.map((e) => e.toLowerCase()).filter(Boolean)
  if (targets.length === 0) return []
  return corpus
    .filter((email) =>
      targets.some((t) => `${email.to} ${email.cc}`.toLowerCase().includes(t)),
    )
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, k)
}

/** Priority 2: semantically similar sent mail, excluding ids already picked. */
export function retrieveBySimilarity(
  corpus: CorpusEmail[],
  embeddings: Record<string, number[]>,
  queryVector: number[],
  excludeIds: Set<string>,
  k = 3,
): CorpusEmail[] {
  return corpus
    .filter((email) => !excludeIds.has(email.id) && embeddings[email.id])
    .map((email) => ({
      email,
      score: cosineSimilarity(queryVector, embeddings[email.id]!),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((r) => r.email)
}

function renderExample(email: CorpusEmail): string {
  return [
    `Subject: ${email.subject}`,
    email.situation ? `Situation: ${email.situation}` : '',
    email.body.slice(0, 800),
  ]
    .filter(Boolean)
    .join('\n')
}

/** The prompt block handed to the drafter — style-only framing built in. */
export function formatExamples(
  contactMatches: CorpusEmail[],
  situationMatches: CorpusEmail[],
): string | null {
  if (contactMatches.length === 0 && situationMatches.length === 0) return null
  return [
    "## Precedent — how Zaire actually writes (STYLE ONLY)",
    'Real past emails Zaire sent, retrieved as precedent for tone, structure, and',
    'length. Facts, numbers, dates, and commitments inside them are historical and',
    'NOT available to this draft — hard rule 3 applies in full.',
    ...(contactMatches.length > 0
      ? ['', '### To this exact contact',
         ...contactMatches.map((e) => `---\n${renderExample(e)}`)]
      : []),
    ...(situationMatches.length > 0
      ? ['', '### Similar situations',
         ...situationMatches.map((e) => `---\n${renderExample(e)}`)]
      : []),
  ].join('\n')
}

/**
 * One-call retrieval for the draft pipeline. Returns a formatted prompt block,
 * or null when the corpus doesn't exist yet or anything fails — retrieval
 * upgrades quality, it is never a dependency (CLAUDE.md build order).
 */
export async function retrieveForDraft(options: {
  recipientEmails: string[]
  queryText: string
  openaiKey: string | undefined
  root?: string
  k?: number
}): Promise<string | null> {
  const root = options.root ?? '.'
  try {
    if (!corpusExists(root)) return null
    const corpus = loadCorpus(root)
    if (corpus.length === 0) return null
    const contactMatches = retrieveByContact(corpus, options.recipientEmails, options.k ?? 3)
    let situationMatches: CorpusEmail[] = []
    const embeddings = loadEmbeddings(root)
    if (options.openaiKey && Object.keys(embeddings).length > 0) {
      const [queryVector] = await embedTexts([options.queryText], options.openaiKey)
      if (queryVector) {
        situationMatches = retrieveBySimilarity(
          corpus,
          embeddings,
          queryVector,
          new Set(contactMatches.map((e) => e.id)),
          options.k ?? 3,
        )
      }
    }
    return formatExamples(contactMatches, situationMatches)
  } catch (error) {
    console.error(
      `retrieval skipped (${(error as Error).message}) — drafting continues on voice-profile.md`,
    )
    return null
  }
}
