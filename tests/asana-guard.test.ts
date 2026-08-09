// Structural guard for CLAUDE.md constraint 2 on the Asana side: creation and
// comments only; never delete; completion only for Arya's own tasks, with the
// assignee verified before the write. If this fails, a forbidden capability was
// added — remove it, don't relax this.

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const connector = readFileSync('src/connectors/asana.ts', 'utf8')

describe('asana connector — create + comment only (spec §2, §14)', () => {
  it('has no DELETE code path', () => {
    expect(connector).not.toMatch(/method:\s*'DELETE'/)
    expect(connector).not.toMatch(/'DELETE'/)
  })

  it('has exactly one PUT, and it is the guarded own-task completion', () => {
    const puts = connector.match(/method:\s*'PUT'/g) ?? []
    expect(puts).toHaveLength(1)
    // The completion function verifies the assignee before writing.
    const completeFn = connector.slice(connector.indexOf('export async function completeOwnTask'))
    expect(completeFn).toContain('task.assigneeGid !== aryaGid')
    expect(completeFn.indexOf('assigneeGid !== aryaGid')).toBeLessThan(
      completeFn.indexOf("method: 'PUT'"),
    )
  })

  it('never edits task fields — no name/notes/assignee/due updates exist', () => {
    // The only PUT body is {completed: true}; nothing else is writable.
    expect(connector).not.toMatch(/method:\s*'PUT'[\s\S]{0,200}(name|notes|assignee|due_on):/)
  })
})
