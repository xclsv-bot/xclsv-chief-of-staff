// Shared runtime context for voice tool handlers: locate the repo's state DB
// whether the process runs from the repo root (dev) or from web/ (Next.js).

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { StateStore } from '../state.js'

export function statePath(): string | null {
  if (process.env.STATE_DB_PATH) return process.env.STATE_DB_PATH
  for (const candidate of [
    join(process.cwd(), 'data', 'state.db'),
    join(process.cwd(), '..', 'data', 'state.db'),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Open the state store, or null when no pipeline has ever run. */
export function openState(): StateStore | null {
  const path = statePath()
  return path ? new StateStore(path) : null
}

export function requireVoiceEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing ${name} in the voice app environment`)
  return value
}
