// create_task (v1.4 spec §5.3) — files an Asana task assigned to Arya, via the
// same create-and-comment-only connector the router uses. Env names follow the
// repo's .env convention (ASANA_ACCESS_TOKEN etc.), not the spec's ASANA_TOKEN.

import { createTask as asanaCreateTask } from '../../connectors/asana.js'
import { requireVoiceEnv } from '../context.js'

export async function createTask(args: Record<string, unknown>): Promise<string> {
  const title = String(args.title ?? '').trim()
  const description = String(args.description ?? '').trim()
  if (!title) throw new Error('the task needs a title')

  const dueRaw = args.due_date
  const due =
    typeof dueRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : undefined

  const task = await asanaCreateTask(requireVoiceEnv('ASANA_ACCESS_TOKEN'), {
    name: title,
    notes: `From a voice session, ${new Date().toISOString().slice(0, 10)}.\n\n${description}`,
    assigneeGid: requireVoiceEnv('ASANA_ARYA_USER_GID'),
    workspaceGid: requireVoiceEnv('ASANA_WORKSPACE_GID'),
    dueOn: due,
  })

  return `Filed: ${title}. Due ${due ?? 'no due date'}. It's in my Asana queue${
    task.permalinkUrl ? ` — link in the transcript: ${task.permalinkUrl}` : ''
  }.`
}
