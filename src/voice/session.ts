// Voice session system prompt (v1.4 spec §6) — the same brain-loading pattern
// as the memo pipeline: ARYA.md first (CLAUDE.md: every agent cycle loads it
// first; its hard rules govern voice too), then the task-relevant files.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function agentDir(): string {
  // Local dev runs from the repo root; the deployed web/ app runs one level in.
  for (const dir of [join(process.cwd(), 'agent'), join(process.cwd(), '..', 'agent')]) {
    if (existsSync(dir)) return dir
  }
  throw new Error('agent/ directory not found — voice sessions need the agent files')
}

function read(dir: string, name: string): string {
  const path = join(dir, name)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

export function buildVoiceSystemPrompt(): string {
  const dir = agentDir()
  return [
    read(dir, 'ARYA.md'),
    '---',
    // How to SPEAK — the briefing style, TTS mechanics, and turn rules.
    // Replaces the old inline conduct block that produced list-reading.
    read(dir, 'voice-conduct.md'),
    '---',
    read(dir, 'arya-scope.md'),
    '---',
    // Zaire's overall voice/register. voice-conduct.md governs HOW Arya
    // speaks; writing-profile.md is context on WHOSE voice she's operating in.
    // The create_draft handler loads this file separately when composing
    // outbound on Zaire's behalf.
    read(dir, 'writing-profile.md'),
    '---',
    read(dir, 'triage-rules.md'),
    '---',
    read(dir, 'feedback-log.md'),
    '---',
    '# Current interface: live voice call with Zaire',
    '',
    'He is likely mobile (driving, walking, mid-task). voice-conduct.md above',
    'governs how you speak — brief like a chief of staff, never read records',
    'aloud.',
    '',
    'When he gives you work, use tools. Never say "I\'ll take care of that"',
    'without actually calling the tool that files it. If the tool fails, say so.',
    '',
    '"What\'s on my plate" → call read_todays_digest first, then BRIEF it per',
    'voice-conduct.md. Do not invent items. Dictated replies → create_draft with',
    'his exact intent (draft lands in Gmail Drafts + Slack for approval — tell',
    'him where). "Remind me to X" → create_task.',
  ].join('\n\n')
}
