// WebRTC client wrapper (spec §9). Flow: mint ephemeral token → peer connection
// with mic audio → SDP exchange with api.openai.com/v1/realtime → data channel
// 'oai-events' for transcripts and function calls. Tool calls relay through our
// backend (/api/tool-call) and results are written back into the session.
// Reference: https://platform.openai.com/docs/guides/realtime-webrtc

export interface VoiceSessionCallbacks {
  onStatus: (status: 'idle' | 'connecting' | 'listening' | 'speaking') => void
  onTranscript: (role: 'user' | 'assistant', content: string) => void
  onError: (message: string) => void
}

export interface VoiceSession {
  end: () => void
  sessionId: string
}

interface OaiEvent {
  type: string
  transcript?: string
  name?: string
  call_id?: string
  arguments?: string
  response?: { id?: string }
}

export async function startVoiceSession(
  callbacks: VoiceSessionCallbacks,
): Promise<VoiceSession> {
  callbacks.onStatus('connecting')
  const sessionId = crypto.randomUUID()

  const tokenResponse = await fetch('/api/session', { method: 'POST' })
  if (!tokenResponse.ok) {
    if (tokenResponse.status === 401) {
      throw new Error('Not authorized — open your bookmarked Arya link (with the key) once.')
    }
    const body = await tokenResponse.text().catch(() => '')
    throw new Error(`Session mint failed (${tokenResponse.status}): ${body.slice(0, 200)}`)
  }
  const { client_secret: clientSecret } = (await tokenResponse.json()) as {
    client_secret: string
  }

  const pc = new RTCPeerConnection()
  const media = await navigator.mediaDevices.getUserMedia({ audio: true })
  for (const track of media.getTracks()) pc.addTrack(track, media)

  // DOM-attached with playsinline — iOS Safari stutters on detached audio
  // elements, which read as "choppy" playback.
  const audio = document.createElement('audio')
  audio.autoplay = true
  audio.setAttribute('playsinline', '')
  audio.style.display = 'none'
  document.body.appendChild(audio)
  pc.ontrack = (event) => {
    audio.srcObject = event.streams[0] ?? null
  }

  const channel = pc.createDataChannel('oai-events')

  const transcriptBuffer = { current: '' }
  channel.onmessage = async (message: MessageEvent<string>) => {
    let event: OaiEvent
    try {
      event = JSON.parse(message.data) as OaiEvent
    } catch {
      return
    }
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        callbacks.onStatus('listening')
        break
      case 'response.created':
        callbacks.onStatus('speaking')
        break
      case 'response.done':
        callbacks.onStatus('listening')
        break
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) callbacks.onTranscript('user', event.transcript.trim())
        break
      case 'response.audio_transcript.delta':
        transcriptBuffer.current += event.transcript ?? ''
        break
      case 'response.audio_transcript.done': {
        const text = (event.transcript ?? transcriptBuffer.current).trim()
        transcriptBuffer.current = ''
        if (text) callbacks.onTranscript('assistant', text)
        break
      }
      case 'response.function_call_arguments.done': {
        // Relay pattern (spec §2): execute against the Chief-of-Staff backend,
        // then write the result back into the session and ask for a response.
        try {
          const result = await fetch('/api/tool-call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: sessionId,
              call_id: event.call_id,
              name: event.name,
              arguments: JSON.parse(event.arguments ?? '{}') as Record<string, unknown>,
            }),
          })
          const { output } = (await result.json()) as { output: string }
          channel.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: event.call_id,
                output,
              },
            }),
          )
          channel.send(JSON.stringify({ type: 'response.create' }))
        } catch {
          callbacks.onError('A tool call failed — tell Arya to try again.')
        }
        break
      }
    }
  }

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)

  // GA Realtime WebRTC endpoint: /v1/realtime/calls (model comes from the
  // ephemeral secret's session config, not a query param). The beta shape
  // /v1/realtime?model=... was retired in the Aug 2025 GA release.
  const sdpResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  })
  if (!sdpResponse.ok) {
    const body = await sdpResponse.text().catch(() => '')
    pc.close()
    for (const track of media.getTracks()) track.stop()
    throw new Error(`SDP handshake failed (${sdpResponse.status}): ${body.slice(0, 200)}`)
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: await sdpResponse.text() })
  callbacks.onStatus('listening')

  return {
    sessionId,
    end: () => {
      channel.close()
      pc.close()
      for (const track of media.getTracks()) track.stop()
      audio.remove()
      callbacks.onStatus('idle')
    },
  }
}
