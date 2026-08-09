// Voice tool schemas + handler dispatch (v1.4 spec §5). Each handler returns a
// short spoken-friendly string; errors become friendly retry prompts rather
// than throws, so the model can relay them naturally.

import { createDraft } from './handlers/create_draft.js'
import { createTask } from './handlers/create_task.js'
import { readTodaysDigest } from './handlers/read_digest.js'
import { searchEmail } from './handlers/search_email.js'
import { sendSlackNote } from './handlers/send_slack_note.js'

export const toolSchemas = [
  {
    type: 'function',
    name: 'read_todays_digest',
    description:
      "Read today's inbox digest — items Zaire needs to respond to, ready nudges, and flags. Use when Zaire asks \"what's on my plate?\" or \"what does my day look like?\"",
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['all', 'needs_you', 'ready_nudges', 'flags'],
          description: 'Which section to read. Default: needs_you.',
        },
      },
    },
  },
  {
    type: 'function',
    name: 'create_draft',
    description:
      'Create an email reply draft in Zaire\'s Gmail for a specific thread. Use when Zaire says "reply to X saying Y" or "draft a response to that thread."',
    parameters: {
      type: 'object',
      properties: {
        digest_item_number: {
          type: 'integer',
          description:
            'The number Zaire referenced (e.g., "#2 in today\'s digest"). Preferred over thread_id when available.',
        },
        thread_id: {
          type: 'string',
          description: 'Gmail thread ID. Only use if digest_item_number is not available.',
        },
        instruction: {
          type: 'string',
          description:
            'What Zaire said the reply should convey. Pass through his actual words as much as possible — the draft generator adapts them into his written voice.',
        },
      },
      required: ['instruction'],
    },
  },
  {
    type: 'function',
    name: 'create_task',
    description:
      'File a task in Asana assigned to Arya (you). Use when Zaire says "remind me to X," "put on the list Y," or "I need you to Z."',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short task title.' },
        description: {
          type: 'string',
          description: 'Full context Zaire gave. Include any deadlines, links, or people mentioned.',
        },
        due_date: {
          type: 'string',
          description: 'ISO date YYYY-MM-DD if Zaire specified one. Null otherwise.',
        },
      },
      required: ['title', 'description'],
    },
  },
  {
    type: 'function',
    name: 'send_slack_note',
    description:
      'Drop an async instruction into #inbox-gps for the memo pipeline to process on its next run. Use when Zaire is giving detailed instructions that need to hit the text pipeline (e.g., long context that should become a proper written reply).',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The exact message to post as if Zaire typed it.',
        },
      },
      required: ['message'],
    },
  },
  {
    type: 'function',
    name: 'search_email',
    description:
      'Search Zaire\'s Gmail for a specific topic, person, or thread. Use when Zaire asks "what did X say?" or "when did we last talk to Y?"',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Gmail search syntax. Examples: "from:andrea tailgate", "subject:MLR after:2026/07/01".',
        },
        max_results: {
          type: 'integer',
          description: 'Cap on returned threads. Default 5.',
        },
      },
      required: ['query'],
    },
  },
]

const HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  read_todays_digest: readTodaysDigest,
  create_draft: createDraft,
  create_task: createTask,
  send_slack_note: sendSlackNote,
  search_email: searchEmail,
}

/** Names with a live handler — tests assert parity with toolSchemas. */
export function registeredTools(): string[] {
  return Object.keys(HANDLERS)
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const handler = HANDLERS[name]
  if (!handler) throw new Error(`Unknown tool: ${name}`)
  try {
    return await handler(args)
  } catch (error) {
    // Voice-appropriate failure (spec §5.6): never a stack trace read aloud.
    return `That didn't go through — ${(error as Error).message}. Tell me again in a minute and I'll retry.`
  }
}
