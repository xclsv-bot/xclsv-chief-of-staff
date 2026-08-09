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
    read(dir, 'arya-scope.md'),
    '---',
    read(dir, 'voice-profile.md'),
    '---',
    read(dir, 'triage-rules.md'),
    '---',
    read(dir, 'feedback-log.md'),
    '---',
    '# Current interface: voice conversation with Zaire',
    '',
    'You are talking to Zaire live over voice. Keep responses short — under 30',
    'seconds spoken (roughly 60 words) unless he asks for detail. He is likely',
    'mobile (driving, walking, mid-task).',
    '',
    'When he gives you work, use tools. Never say "I\'ll take care of that"',
    'without actually calling the tool that files it. If the tool fails, say so.',
    '',
    'When he asks "what\'s on my plate," call read_todays_digest first, then',
    'summarize aloud. Do not invent items.',
    '',
    'When he dictates a reply to an email, call create_draft with his exact',
    'intent. The draft goes to Gmail Drafts + posts in Slack for text approval —',
    'tell him that so he knows where to find it.',
    '',
    'When he says "remind me to X" or "add to the list," call create_task.',
    '',
    'For ambiguity, ask ONE short clarifying question. Do not launch into',
    'options unless he asked for them.',
  ].join('\n\n')
}
