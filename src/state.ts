import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type GpsLabel = '1-Respond' | '2-Review' | '3-Waiting' | 'Archive'
export type DraftStatus = 'none' | 'pending' | 'approved' | 'revised'

export interface ThreadState {
  threadId: string
  label: GpsLabel
  lowConfidence: boolean
  needsReading: boolean
  waitingSince: string | null
  nudgeCount: number
  draftStatus: DraftStatus
  snoozedUntil: string | null
  slackRefs: string | null
  lastMessageId: string | null
  /** ISO date of the newest message — the age basis for digest lines. */
  lastMessageDate: string | null
  subject: string | null
  reason: string | null
  /** One-line "Sender / Company — the ask" written at classification time. */
  digestLine: string | null
  updatedAt: string
}

export interface DigestItemRef {
  number: number
  threadId: string
  section: 'needs_you' | 'ready_nudges'
}

export interface DigestRecord {
  id: number
  postedAt: string
  channel: string
  slackTs: string
  items: DigestItemRef[]
}

interface ThreadRow {
  thread_id: string
  label: string
  low_confidence: number
  needs_reading: number
  waiting_since: string | null
  nudge_count: number
  draft_status: string
  snoozed_until: string | null
  slack_refs: string | null
  last_message_id: string | null
  last_message_date: string | null
  subject: string | null
  reason: string | null
  digest_line: string | null
  updated_at: string
}

function toState(row: ThreadRow): ThreadState {
  return {
    threadId: row.thread_id,
    label: row.label as GpsLabel,
    lowConfidence: row.low_confidence === 1,
    needsReading: row.needs_reading === 1,
    waitingSince: row.waiting_since,
    nudgeCount: row.nudge_count,
    draftStatus: row.draft_status as DraftStatus,
    snoozedUntil: row.snoozed_until,
    slackRefs: row.slack_refs,
    lastMessageId: row.last_message_id,
    lastMessageDate: row.last_message_date,
    subject: row.subject,
    reason: row.reason,
    digestLine: row.digest_line,
    updatedAt: row.updated_at,
  }
}

export class StateStore {
  private db: Database.Database

  constructor(path = 'data/state.db') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id       TEXT PRIMARY KEY,
        label           TEXT NOT NULL,
        low_confidence  INTEGER NOT NULL DEFAULT 0,
        needs_reading   INTEGER NOT NULL DEFAULT 0,
        waiting_since   TEXT,
        nudge_count     INTEGER NOT NULL DEFAULT 0,
        draft_status    TEXT NOT NULL DEFAULT 'none',
        snoozed_until   TEXT,
        slack_refs      TEXT,
        last_message_id TEXT,
        last_message_date TEXT,
        subject         TEXT,
        reason          TEXT,
        digest_line     TEXT,
        updated_at      TEXT NOT NULL
      )
    `)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS digests (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        posted_at TEXT NOT NULL,
        channel   TEXT NOT NULL,
        slack_ts  TEXT NOT NULL,
        items     TEXT NOT NULL
      )
    `)
    // Columns added after stage 2 — migrate any pre-existing database in place.
    const columns = (this.db.pragma('table_info(threads)') as { name: string }[]).map(
      (c) => c.name,
    )
    for (const [name, ddl] of [
      ['last_message_date', 'ALTER TABLE threads ADD COLUMN last_message_date TEXT'],
      ['digest_line', 'ALTER TABLE threads ADD COLUMN digest_line TEXT'],
    ] as const) {
      if (!columns.includes(name)) this.db.exec(ddl)
    }
  }

  get(threadId: string): ThreadState | undefined {
    const row = this.db
      .prepare('SELECT * FROM threads WHERE thread_id = ?')
      .get(threadId) as ThreadRow | undefined
    return row ? toState(row) : undefined
  }

  byLabel(label: GpsLabel): ThreadState[] {
    const rows = this.db
      .prepare('SELECT * FROM threads WHERE label = ?')
      .all(label) as ThreadRow[]
    return rows.map(toState)
  }

  upsert(state: Omit<ThreadState, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO threads (
           thread_id, label, low_confidence, needs_reading, waiting_since,
           nudge_count, draft_status, snoozed_until, slack_refs,
           last_message_id, last_message_date, subject, reason, digest_line, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET
           label = excluded.label,
           low_confidence = excluded.low_confidence,
           needs_reading = excluded.needs_reading,
           waiting_since = excluded.waiting_since,
           nudge_count = excluded.nudge_count,
           draft_status = excluded.draft_status,
           snoozed_until = excluded.snoozed_until,
           slack_refs = excluded.slack_refs,
           last_message_id = excluded.last_message_id,
           last_message_date = excluded.last_message_date,
           subject = excluded.subject,
           reason = excluded.reason,
           digest_line = excluded.digest_line,
           updated_at = excluded.updated_at`,
      )
      .run(
        state.threadId,
        state.label,
        state.lowConfidence ? 1 : 0,
        state.needsReading ? 1 : 0,
        state.waitingSince,
        state.nudgeCount,
        state.draftStatus,
        state.snoozedUntil,
        state.slackRefs,
        state.lastMessageId,
        state.lastMessageDate,
        state.subject,
        state.reason,
        state.digestLine,
        new Date().toISOString(),
      )
  }

  saveDigest(channel: string, slackTs: string, items: DigestItemRef[]): void {
    this.db
      .prepare('INSERT INTO digests (posted_at, channel, slack_ts, items) VALUES (?, ?, ?, ?)')
      .run(new Date().toISOString(), channel, slackTs, JSON.stringify(items))
  }

  latestDigest(): DigestRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM digests ORDER BY id DESC LIMIT 1')
      .get() as { id: number; posted_at: string; channel: string; slack_ts: string; items: string } | undefined
    if (!row) return undefined
    return {
      id: row.id,
      postedAt: row.posted_at,
      channel: row.channel,
      slackTs: row.slack_ts,
      items: JSON.parse(row.items) as DigestItemRef[],
    }
  }

  close(): void {
    this.db.close()
  }
}
