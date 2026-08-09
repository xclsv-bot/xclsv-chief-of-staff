// POST /api/tool-call — the relay (spec §8): the browser forwards Realtime
// function-call payloads here; we execute them against the Chief-of-Staff
// internals, log every call to voice_tool_calls (spec §11), and return the
// spoken-result string.

import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { executeToolCall } from '../../../../src/voice/tools'
import { persistToolCall } from '../../../../src/voice/transcript'

export async function POST(request: Request) {
  if (!(await checkAuth(request))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { session_id, call_id, name, arguments: args } = (await request.json()) as {
    session_id?: string
    call_id?: string
    name: string
    arguments: Record<string, unknown>
  }
  const sessionId = session_id ?? 'unknown'
  const callId = call_id ?? 'unknown'

  try {
    const result = await executeToolCall(name, args ?? {})
    await persistToolCall({ sessionId, callId, name, args, result })
    return NextResponse.json({ output: result })
  } catch (error) {
    const message = (error as Error).message
    await persistToolCall({ sessionId, callId, name, args, error: message })
    return NextResponse.json({ output: `Tool failed: ${message}` })
  }
}
