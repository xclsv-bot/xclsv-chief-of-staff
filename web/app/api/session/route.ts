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

  // GA Realtime API (gpt-realtime, Aug 2025): endpoint renamed to
  // /v1/realtime/client_secrets; audio/transcription/turn_detection moved under
  // session.audio; response returns { value, expires_at } at top level.
  const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      session: {
        type: 'realtime',
        model: process.env.OPENAI_REALTIME_MODEL ?? 'gpt-realtime',
        instructions: buildVoiceSystemPrompt(),
        tools: toolSchemas,
        tool_choice: 'auto',
        audio: {
          output: { voice: process.env.VOICE_ID ?? 'sage' },
          input: {
            transcription: { model: 'whisper-1' },
            // Semantic VAD: the model judges when Zaire has FINISHED A THOUGHT
            // instead of counting milliseconds of silence — this is what makes
            // ChatGPT's voice mode wait through pauses and "um"s rather than
            // jumping in (live feedback, 2026-08-09). 'low' eagerness = most
            // patient. Set VOICE_TURN_DETECTION=server_vad to fall back.
            turn_detection:
              process.env.VOICE_TURN_DETECTION === 'server_vad'
                ? {
                    type: 'server_vad',
                    threshold: 0.5,
                    prefix_padding_ms: 300,
                    silence_duration_ms: 1000,
                  }
                : {
                    type: 'semantic_vad',
                    eagerness: process.env.VOICE_TURN_EAGERNESS ?? 'low',
                  },
          },
        },
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error('[session-mint] OpenAI', response.status, body.slice(0, 400))
    return new NextResponse(body, { status: 500 })
  }

  const data = (await response.json()) as { value: string; expires_at: number }
  console.log('[session-mint] ok', data.value.slice(0, 12), 'expires', data.expires_at)
  return NextResponse.json({
    client_secret: data.value,
    expires_at: data.expires_at,
  })
}
