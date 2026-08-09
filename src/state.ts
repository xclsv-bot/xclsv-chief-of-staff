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

export type DraftKind = 'reply' | 'delegation' | 'nudge'
export type DraftRecordStatus = 'pending' | 'approved' | 'superseded'

export interface DraftRecord {
  id: number
  threadId: string
  kind: DraftKind
  status: DraftRecordStatus
  body: string
  toAddr: string | null
  ccAddr: string | null
  subject: string | null
  headerLine: string | null
  instruction: string | null
  channel: string | null
  /** ts of the Slack message carrying this draft (the ✅ target). */
  slackTs: string | null
  /** ts of the digest this draft was posted under. */
  digestSlackTs: string | null
  itemNumber: number | null
  createdAt: string
  updatedAt: string
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

interface DraftRow {
  id: number
  thread_id: string
  kind: string
  status: string
  body: string
  to_addr: string | null
  cc_addr: string | null
  subject: string | null
  header_line: string | null
  instruction: string | null
  channel: string | null
  slack_ts: string | null
  digest_slack_ts: string | null
  item_number: number | null
  created_at: string
  updated_at: string
}

function toDraft(row: DraftRow): DraftRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    kind: row.kind as DraftKind,
    status: row.status as DraftRecordStatus,
    body: row.body,
    toAddr: row.to_addr,
    ccAddr: row.cc_addr,
    subject: row.subject,
    headerLine: row.header_line,
    instruction: row.instruction,
    channel: row.channel,
    slackTs: row.slack_ts,
    digestSlackTs: row.digest_slack_ts,
    itemNumber: row.item_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS drafts (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id      TEXT NOT NULL,
        kind           TEXT NOT NULL,
        status         TEXT NOT NULL,
        body           TEXT NOT NULL,
        to_addr        TEXT,
        cc_addr        TEXT,
        subject        TEXT,
        header_line    TEXT,
        instruction    TEXT,
        channel        TEXT,
        slack_ts       TEXT,
        digest_slack_ts TEXT,
        item_number    INTEGER,
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL
      )
    `)
    // Slack messages already acted on — the poller's idempotency ledger.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS handled_slack (
        slack_ts   TEXT PRIMARY KEY,
        handled_at TEXT NOT NULL
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
    return this.digestsSince('')[0]
  }

  /** Digests posted at/after the ISO timestamp, newest first. */
  digestsSince(sinceIso: string): DigestRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM digests WHERE posted_at >= ? ORDER BY id DESC')
      .all(sinceIso) as { id: number; posted_at: string; channel: string; slack_ts: string; items: string }[]
    return rows.map((row) => ({
      id: row.id,
      postedAt: row.posted_at,
      channel: row.channel,
      slackTs: row.slack_ts,
      items: JSON.parse(row.items) as DigestItemRef[],
    }))
  }

  createDraft(draft: Omit<DraftRecord, 'id' | 'createdAt' | 'updatedAt'>): number {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO drafts (
           thread_id, kind, status, body, to_addr, cc_addr, subject, header_line,
           instruction, channel, slack_ts, digest_slack_ts, item_number,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.threadId, draft.kind, draft.status, draft.body, draft.toAddr,
        draft.ccAddr, draft.subject, draft.headerLine, draft.instruction,
        draft.channel, draft.slackTs, draft.digestSlackTs, draft.itemNumber,
        now, now,
      )
    return Number(result.lastInsertRowid)
  }

  setDraftStatus(id: number, status: DraftRecordStatus): void {
    this.db
      .prepare('UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id)
  }

  draftsByStatus(status: DraftRecordStatus): DraftRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM drafts WHERE status = ? ORDER BY id')
      .all(status) as DraftRow[]
    return rows.map(toDraft)
  }

  draftsForThread(threadId: string): DraftRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM drafts WHERE thread_id = ? ORDER BY id')
      .all(threadId) as DraftRow[]
    return rows.map(toDraft)
  }

  isHandled(slackTs: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM handled_slack WHERE slack_ts = ?').get(slackTs) !==
      undefined
    )
  }

  markHandled(slackTs: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO handled_slack (slack_ts, handled_at) VALUES (?, ?)')
      .run(slackTs, new Date().toISOString())
  }

  close(): void {
    this.db.close()
  }
}
