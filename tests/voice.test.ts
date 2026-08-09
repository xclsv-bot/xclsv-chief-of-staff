// Unit tests for the voice interface (v1.4 spec §13) — pure paths only: tool
// dispatch parity, auth, the spoken digest formatter, and transcript tables.
// Live audio/tool round-trips are the spec's manual smoke tests at deploy.

import { describe, expect, it } from 'vitest'
import { formatSpokenDigest } from '../src/voice/handlers/read_digest.js'
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
      'read_todays_digest',
      'search_email',
      'send_slack_note',
    ])
  })

  it('throws on an unknown tool', async () => {
    await expect(executeToolCall('send_email', {})).rejects.toThrow('Unknown tool')
  })

  it('turns handler errors into voice-friendly strings, not throws', async () => {
    // create_task with no env configured fails inside the handler → friendly retry line.
    const result = await executeToolCall('create_task', { title: 'x', description: 'y' })
    expect(result).toContain("didn't go through")
    expect(result).not.toMatch(/\n\s+at /) // no stack traces read aloud
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
