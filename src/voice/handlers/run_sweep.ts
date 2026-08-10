// run_triage_sweep — on-demand inbox sweep from a voice session, so "sweep the
// inbox" doesn't wait for the top of the hour. Idempotency makes this cheap:
// already-triaged threads skip, so only mail that arrived since the last run
// costs a classification.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runSweep, summarizeSweep } from '../../pipelines/triage.js'
import { statePath } from '../context.js'

function repoAgentDir(): string | undefined {
  for (const dir of [join(process.cwd(), 'agent'), join(process.cwd(), '..', 'agent')]) {
    if (existsSync(dir)) return dir
  }
  return undefined
}

export async function runTriageSweep(_args: Record<string, unknown>): Promise<string> {
  const result = await runSweep({
    dryRun: false,
    // Smaller cap than cron's 100 — this is "catch me up," not backfill.
    maxThreads: Number(process.env.VOICE_SWEEP_MAX_THREADS ?? 40),
    agentDir: repoAgentDir(),
    statePath: statePath() ?? undefined,
  })
  return `Sweep done, ${result.candidates} threads checked. ${summarizeSweep(result)}`
}
