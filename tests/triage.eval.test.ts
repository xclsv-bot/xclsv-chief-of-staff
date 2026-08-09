// Live classification eval against the synthetic fixture set (CLAUDE.md testing
// expectations). Calls the Anthropic API — opt in with:
//
//   npm run test:eval        (requires ANTHROPIC_API_KEY)
//
// Asserts the label for every judgment fixture; confidence/needs_reading are
// asserted only where the fixture pins them down.

import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { classifyThread, loadAgentFiles } from '../src/pipelines/classify.js'
import { CLASSIFY_FIXTURES } from './fixtures/synthetic-emails.js'

const enabled = process.env.RUN_TRIAGE_EVAL === '1' && !!process.env.ANTHROPIC_API_KEY

describe.skipIf(!enabled)('triage classification eval (live API)', () => {
  const client = new Anthropic()
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5'
  const files = loadAgentFiles()

  it.each(CLASSIFY_FIXTURES.map((f) => [f.id, f] as const))(
    '%s',
    async (_id, fixture) => {
      const result = await classifyThread(client, model, fixture.thread, files)
      expect(result.label).toBe(fixture.expected.label)
      if (fixture.expected.needsReading) {
        expect(result.needsReading).toBe(true)
      }
    },
    60_000,
  )
})
