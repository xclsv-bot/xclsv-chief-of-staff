// POST /api/session — mints an ephemeral OpenAI Realtime session (spec §7)
// with the Arya system prompt (agent files) and tool schemas. The browser
// never sees OPENAI_API_KEY; it gets a short-lived client secret.

import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { buildVoiceSystemPrompt } from '../../../../src/voice/session'
import { toolSchemas } from '../../../../src/voice/tools'

export async function POST(request: Request) {
  if (!(await checkAuth(request))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-4o-realtime-preview-2024-12-17',
      voice: process.env.VOICE_ID ?? 'sage',
      instructions: buildVoiceSystemPrompt(),
      tools: toolSchemas,
      tool_choice: 'auto',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: { type: 'server_vad', threshold: 0.5 },
    }),
  })

  if (!response.ok) {
    return new NextResponse(await response.text(), { status: 500 })
  }

  const data = (await response.json()) as {
    client_secret: { value: string; expires_at: number }
  }
  return NextResponse.json({
    client_secret: data.client_secret.value,
    expires_at: data.client_secret.expires_at,
  })
}
