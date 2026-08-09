// read_todays_digest (v1.4 spec §5.1) — speaks the latest digest from the same
// SQLite state the text pipeline maintains. Never invents items: this handler
// is the source of truth for "what's on my plate."

import { aryaTaskFlags } from '../../pipelines/asana_router.js'
import { staleDraftFlags } from '../../pipelines/digest.js'
import type { StateStore, ThreadState } from '../../state.js'
import { openState } from '../context.js'

function age(thread: ThreadState | undefined, now: Date): string {
  if (!thread?.lastMessageDate) return ''
  const days = Math.max(
    0,
    Math.floor((now.getTime() - new Date(thread.lastMessageDate).getTime()) / 86_400_000),
  )
  return days === 0 ? '' : days === 1 ? ', waiting 1 day' : `, waiting ${days} days`
}

function spokenItems(
  store: StateStore,
  items: { number: number; threadId: string }[],
  now: Date,
  cap = 8,
): string[] {
  const lines = items.slice(0, cap).map((item) => {
    const thread = store.get(item.threadId)
    const summary = thread?.digestLine ?? thread?.subject ?? 'an unlabeled thread'
    return `${item.number}: ${summary}${age(thread, now)}.`
  })
  if (items.length > cap) lines.push(`And ${items.length - cap} more beyond that.`)
  return lines
}

export function formatSpokenDigest(
  store: StateStore,
  section: 'all' | 'needs_you' | 'ready_nudges' | 'flags',
  now: Date,
): string {
  const digest = store.latestDigest()
  if (!digest) {
    return 'No digest has been posted yet today — the inbox pipeline may not have run.'
  }
  const needsYou = digest.items.filter((i) => i.section === 'needs_you')
  const nudges = digest.items.filter((i) => i.section === 'ready_nudges')
  const flags = [
    ...staleDraftFlags(store.draftsByStatus('pending'), now),
    ...aryaTaskFlags(store.allAryaTasks(), now),
  ]

  const parts: string[] = []
  if (section === 'all' || section === 'needs_you') {
    parts.push(
      needsYou.length === 0
        ? 'Nothing needs your response right now.'
        : `${needsYou.length === 1 ? 'One item needs' : `${needsYou.length} items need`} you. ${spokenItems(store, needsYou, now).join(' ')}`,
    )
  }
  if (section === 'all' || section === 'ready_nudges') {
    if (nudges.length > 0) {
      parts.push(
        `${nudges.length === 1 ? 'One follow-up is' : `${nudges.length} follow-ups are`} ready to send — say nudge and the number. ${spokenItems(store, nudges, now).join(' ')}`,
      )
    } else if (section === 'ready_nudges') {
      parts.push('No follow-ups are waiting on your approval.')
    }
  }
  if (section === 'all' || section === 'flags') {
    if (flags.length > 0) {
      parts.push(`${flags.length === 1 ? 'One flag' : `${flags.length} flags`}: ${flags.join('. ')}.`)
    } else if (section === 'flags') {
      parts.push('No flags.')
    }
  }
  return parts.join(' ')
}

export async function readTodaysDigest(args: Record<string, unknown>): Promise<string> {
  const section = (args.section as 'all' | 'needs_you' | 'ready_nudges' | 'flags') ?? 'needs_you'
  const store = openState()
  if (!store) {
    return 'The inbox state database is not reachable from here — the digest pipeline may not have run yet.'
  }
  try {
    return formatSpokenDigest(store, section, new Date())
  } finally {
    store.close()
  }
}
