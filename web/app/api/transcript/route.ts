// POST /api/transcript — session-end transcript flush (spec §2 lifecycle /
// §11). The spec defines the persistence but no route for it; this is that
// route, called by the client on end/pagehide.

import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { persistTranscript } from '../../../../src/voice/transcript'

export async function POST(request: Request) {
  if (!(await checkAuth(request))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  const { session_id, transcript } = (await request.json()) as {
    session_id: string
    transcript: { role: string; content: string; timestamp: string }[]
  }
  if (!session_id || !Array.isArray(transcript)) {
    return new NextResponse('Bad request', { status: 400 })
  }
  await persistTranscript(session_id, transcript)
  return NextResponse.json({ ok: true })
}
