// Asana connector — CREATE TASKS AND ADD COMMENTS ONLY (spec §2, §14).
// On Zaire's tasks Arya never completes, edits, reassigns, or deletes — those
// code paths do not exist here, and tests/asana-guard.test.ts keeps it that way.
// The single exception (spec §14.1): Arya may complete a task assigned to HER,
// and completeOwnTask verifies the assignee before touching it.

const BASE = 'https://app.asana.com/api/1.0'

async function asanaFetch(
  token: string,
  path: string,
  init?: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown },
): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
    body: init?.body ? JSON.stringify({ data: init.body }) : undefined,
  })
  if (!res.ok) throw new Error(`Asana ${path} failed: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { data: unknown }).data
}

export interface AsanaTask {
  gid: string
  name: string
  notes: string
  completed: boolean
  assigneeGid: string | null
  permalinkUrl: string
}

interface RawTask {
  gid?: string
  name?: string
  notes?: string
  completed?: boolean
  assignee?: { gid?: string } | null
  permalink_url?: string
}

function toTask(raw: RawTask): AsanaTask {
  return {
    gid: raw.gid ?? '',
    name: raw.name ?? '',
    notes: raw.notes ?? '',
    completed: raw.completed ?? false,
    assigneeGid: raw.assignee?.gid ?? null,
    permalinkUrl: raw.permalink_url ?? '',
  }
}

/** Create a task in the assignee's My Tasks (unsectioned — spec §14). */
export async function createTask(
  token: string,
  options: {
    name: string
    notes: string
    assigneeGid: string
    workspaceGid: string
    dueOn?: string
  },
): Promise<AsanaTask> {
  const raw = (await asanaFetch(token, '/tasks', {
    method: 'POST',
    body: {
      name: options.name,
      notes: options.notes,
      assignee: options.assigneeGid,
      workspace: options.workspaceGid,
      ...(options.dueOn ? { due_on: options.dueOn } : {}),
    },
  })) as RawTask
  return toTask(raw)
}

export async function addComment(
  token: string,
  taskGid: string,
  text: string,
): Promise<void> {
  await asanaFetch(token, `/tasks/${taskGid}/stories`, {
    method: 'POST',
    body: { text },
  })
}

export async function listOpenTasks(
  token: string,
  assigneeGid: string,
  workspaceGid: string,
): Promise<AsanaTask[]> {
  const raw = (await asanaFetch(
    token,
    `/tasks?assignee=${assigneeGid}&workspace=${workspaceGid}&completed_since=now` +
      '&opt_fields=name,notes,completed,assignee.gid,permalink_url',
  )) as RawTask[]
  return raw.map(toTask)
}

export async function getTask(token: string, taskGid: string): Promise<AsanaTask> {
  const raw = (await asanaFetch(
    token,
    `/tasks/${taskGid}?opt_fields=name,notes,completed,assignee.gid,permalink_url`,
  )) as RawTask
  return toTask(raw)
}

export interface AsanaComment {
  createdByGid: string
  text: string
}

export async function listComments(
  token: string,
  taskGid: string,
): Promise<AsanaComment[]> {
  const raw = (await asanaFetch(
    token,
    `/tasks/${taskGid}/stories?opt_fields=type,text,created_by.gid`,
  )) as { type?: string; text?: string; created_by?: { gid?: string } }[]
  return raw
    .filter((s) => s.type === 'comment')
    .map((s) => ({ createdByGid: s.created_by?.gid ?? '', text: s.text ?? '' }))
}

/**
 * Spec §14.1: "Arya may mark complete only tasks assigned to her." The assignee
 * check here is the enforcement — this function refuses anything else, and no
 * other completion path exists in this codebase.
 */
export async function completeOwnTask(
  token: string,
  taskGid: string,
  aryaGid: string,
): Promise<void> {
  const task = await getTask(token, taskGid)
  if (task.assigneeGid !== aryaGid) {
    throw new Error(
      `refusing to complete task ${taskGid}: assigned to ${task.assigneeGid ?? 'nobody'}, not Arya`,
    )
  }
  await asanaFetch(token, `/tasks/${taskGid}`, {
    method: 'PUT',
    body: { completed: true },
  })
}
