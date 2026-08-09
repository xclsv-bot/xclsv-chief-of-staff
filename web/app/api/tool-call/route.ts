// POST /api/tool-call — the relay (spec §8): the browser forwards Realtime
// function-call payloads here; we execute them against the Chief-of-Staff
// internals and return the spoken-result string. Per-call persistence into
// voice_tool_calls is wired in build step 12.

import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { executeToolCall } from '../../../../src/voice/tools'

export async function POST(request: Request) {
  if (!(await checkAuth(request))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { name, arguments: args } = (await request.json()) as {
    session_id?: string
    call_id?: string
    name: string
    arguments: Record<string, unknown>
  }

  try {
    const result = await executeToolCall(name, args ?? {})
    return NextResponse.json({ output: result })
  } catch (error) {
    return NextResponse.json({ output: `Tool failed: ${(error as Error).message}` })
  }
}
