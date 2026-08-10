// Voice session system prompt (v1.4 spec §6) — the same brain-loading pattern
// the other pipelines use: ARYA.md first (CLAUDE.md: every agent cycle loads it
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

/**
 * The session's time anchor. All pipeline scheduling is Pacific (spec §2), so
 * Arya's spoken "now" is Pacific too — computed fresh per session, because the
 * model has no clock of its own and will otherwise guess from stale data.
 */
export function nowLinePT(now = new Date()): string {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now)
  return `Right now it is ${formatted}.`
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
    // writing-profile.md is intentionally NOT loaded here — it's for composed
    // email drafts, not spoken briefings, and mixing the two led to Arya
    // reading records aloud in Zaire's written register. The create_draft
    // handler loads writing-profile.md on its own when actually drafting.
    read(dir, 'triage-rules.md'),
    '---',
    read(dir, 'feedback-log.md'),
    '---',
    '# Current interface: live voice call with Zaire',
    '',
    nowLinePT(),
    'That line is your ONLY source of the current date and time. "Today,"',
    '"this morning," "yesterday" all resolve against it — never against dates',
    'you see inside digests, emails, or tasks. When the data you are reading is',
    'from an earlier day, SAY SO ("that digest is from Thursday") instead of',
    'presenting it as current.',
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
    'him where). "Remind me to X" → create_task. "Post in Slack / tell the',
    'team" → send_slack_message. "Anything in Slack?" → read_slack, then brief',
    'it — never read raw messages verbatim.',
    '',
    'DATA FRESHNESS: the digest is a SNAPSHOT from the last pipeline run, not',
    'the live inbox. For "what came in the last hour / this morning / just',
    'now," call search_email with since_hours — never answer recency questions',
    'from the digest, and never claim "no new email" without a live search.',
    'When he wants new mail TRIAGED, not just listed ("sweep the inbox," "catch',
    'me up"), say a short preamble and call run_triage_sweep — it labels',
    'everything new and tells you what now needs him.',
  ].join('\n\n')
}
