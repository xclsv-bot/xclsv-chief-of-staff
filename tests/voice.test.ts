// Unit tests for the voice interface (v1.4 spec §13) — pure paths only: tool
// dispatch parity, auth, the spoken digest formatter, and transcript tables.
// Live audio/tool round-trips are the spec's manual smoke tests at deploy.

import { describe, expect, it } from 'vitest'
import { formatSpokenDigest } from '../src/voice/handlers/read_digest.js'
import { buildGmailQuery } from '../src/voice/handlers/search_email.js'
import { isSweepCommand } from '../src/pipelines/commands.js'
import { summarizeSweep } from '../src/pipelines/triage.js'
import { nowLinePT } from '../src/voice/session.js'
import { executeToolCall, registeredTools, toolSchemas } from '../src/voice/tools.js'
import { StateStore } from '../src/state.js'
import { keyMatches } from '../web/lib/secret.js'

describe('tool dispatch (spec §5.6)', () => {
  it('every schema has a handler and every handler has a schema', () => {
    const schemaNames = toolSchemas.map((s) => s.name).sort()
    expect(schemaNames).toEqual(registeredTools().sort())
    expect(schemaNames).toEqual([
      'create_draft',
      'create_task',
      'read_slack',
      'read_todays_digest',
      'run_triage_sweep',
      'search_email',
      'send_slack_message',
    ])
  })

  it('throws on an unknown tool', async () => {
    await expect(executeToolCall('send_email', {})).rejects.toThrow('Unknown tool')
  })

  it('turns handler errors into voice-friendly strings, not throws', async () => {
    // Missing required title hits the handler's own input guard — no live API
    // call to Asana. (Prior version passed a valid title, which filed a real
    // task when .env was populated. Never test with mutating side effects.)
    const result = await executeToolCall('create_task', {})
    expect(result).toContain("didn't go through")
    expect(result).toContain('the task needs a title')
    expect(result).not.toMatch(/\n\s+at /) // no stack traces read aloud
  })
})

describe('buildGmailQuery (recency — Gmail has no hour-level relative filter)', () => {
  const NOW = Date.parse('2026-08-10T18:00:00Z')

  it('converts since_hours to a precise epoch after: filter', () => {
    expect(buildGmailQuery('from:andrea', 2, NOW)).toBe(
      `from:andrea after:${Math.floor(NOW / 1000) - 2 * 3600}`,
    )
  })

  it('defaults to the whole inbox when only since_hours is given', () => {
    expect(buildGmailQuery('', 1, NOW)).toBe(`in:inbox after:${Math.floor(NOW / 1000) - 3600}`)
  })

  it('leaves plain queries untouched', () => {
    expect(buildGmailQuery('subject:MLR', null, NOW)).toBe('subject:MLR')
  })
})

describe('on-demand sweep (voice + Slack command)', () => {
  it('recognizes sweep commands from natural phrasings, from Zaire only by caller filter', () => {
    for (const text of ['sweep', 'Run a sweep please', 'refresh the inbox', 'triage now', 'can you refresh emails']) {
      expect(isSweepCommand(text), text).toBe(true)
    }
    for (const text of ['what a sweeping view', 'nudge #4', 'approve 2']) {
      expect(isSweepCommand(text), text).toBe(false)
    }
  })

  it('summarizes results for the ear — new needs-you items lead', () => {
    const spoken = summarizeSweep({
      candidates: 12,
      counts: { '1-Respond': 3, '2-Review': 2, Archive: 4 },
      failures: 0,
      newRespond: ['Luis / Outlier — slate confirm', 'Tony — call me'],
    })
    expect(spoken).toContain('2 new things need you')
    expect(spoken).toContain('Luis / Outlier')
    expect(spoken).toContain('2 filed to review and 4 archived')
    const quiet = summarizeSweep({ candidates: 5, counts: {}, failures: 0, newRespond: [] })
    expect(quiet).toContain('Nothing new needs you')
  })
})

describe('auth (spec §10)', () => {
  it('rejects missing or wrong secrets and accepts the right one', () => {
    expect(keyMatches(undefined, 'secret')).toBe(false)
    expect(keyMatches('wrong', 'secret')).toBe(false)
    expect(keyMatches('secret', undefined)).toBe(false)
    expect(keyMatches('', '')).toBe(false)
    expect(keyMatches('secret', 'secret')).toBe(true)
  })
})

describe('formatSpokenDigest (spec §5.1 — never invents items)', () => {
  function seededStore(): StateStore {
    const store = new StateStore(':memory:')
    store.upsert({
      threadId: 't1',
      label: '1-Respond',
      lowConfidence: false,
      needsReading: false,
      waitingSince: null,
      nudgeCount: 0,
      draftStatus: 'none',
      snoozedUntil: null,
      slackRefs: null,
      lastMessageId: 'm1',
      lastMessageDate: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      subject: 'September slate scope',
      reason: null,
      digestLine: 'Luis / Outlier — asking to confirm September slate scope',
    })
    store.saveDigest('C1', '100.1', [
      { number: 1, threadId: 't1', section: 'needs_you' },
    ])
    return store
  }

  it('speaks stored items with age, under 500 chars', () => {
    const store = seededStore()
    const spoken = formatSpokenDigest(store, 'needs_you', new Date())
    expect(spoken).toContain('One item needs you.')
    expect(spoken).toContain('1: Luis / Outlier — asking to confirm September slate scope, waiting 3 days.')
    expect(spoken.length).toBeLessThan(500)
    expect(spoken).not.toContain('http')
    store.close()
  })

  it('says so when no digest exists — it does not invent one', () => {
    const store = new StateStore(':memory:')
    expect(formatSpokenDigest(store, 'all', new Date())).toContain(
      'No digest has been posted yet',
    )
    store.close()
  })

  it('flags a stale digest instead of presenting it as today (time honesty)', () => {
    const store = seededStore() // digest posted "now"
    const threeDaysLater = new Date(Date.now() + 3 * 86_400_000)
    const spoken = formatSpokenDigest(store, 'needs_you', threeDaysLater)
    expect(spoken).toContain('Heads up: the latest digest is from')
    expect(spoken).toContain('nothing newer has posted')
    // Same-day read carries no stale note.
    expect(formatSpokenDigest(store, 'needs_you', new Date())).not.toContain('Heads up')
    store.close()
  })
})

describe('nowLinePT (session time anchor)', () => {
  it('renders the current moment in Pacific time with weekday and date', () => {
    const line = nowLinePT(new Date('2026-08-09T22:41:00Z'))
    expect(line).toBe('Right now it is Sunday, August 9, 2026 at 3:41 PM PDT.')
  })
})

describe('voice transcript tables (spec §11)', () => {
  it('logs tool calls and round-trips a session transcript', () => {
    const store = new StateStore(':memory:')
    store.logVoiceToolCall({
      sessionId: 's1',
      callId: 'c1',
      toolName: 'create_task',
      args: { title: 'x' },
      result: 'Filed: x.',
    })
    store.saveVoiceTranscript('s1', [
      { role: 'user', content: 'remind me to x', timestamp: '2026-08-09T12:00:00Z' },
      { role: 'assistant', content: 'Filed: x.', timestamp: '2026-08-09T12:00:05Z' },
    ])
    // Second call upserts the same session row rather than duplicating it.
    store.saveVoiceTranscript('s1', [
      { role: 'user', content: 'remind me to x', timestamp: '2026-08-09T12:00:00Z' },
    ])
    store.close()
  })
})
