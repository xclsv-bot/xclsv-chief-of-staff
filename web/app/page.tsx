'use client'

// The listening orb (Zaire's call, 2026-08-09): no on-screen transcript, no
// running summary of what he's saying — one bubble in the middle that talks
// back and forth. Transcripts are still captured silently and persisted to the
// state DB on session end (spec §11); they just never render.

import { useEffect, useRef, useState } from 'react'
import { startVoiceSession, type VoiceSession } from '@/lib/webrtc'

type Status = 'idle' | 'connecting' | 'listening' | 'speaking'
interface Turn {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

const HINTS: Record<Status, string> = {
  idle: 'Tap to talk to Arya',
  connecting: 'Connecting…',
  listening: 'Listening — tap to end',
  speaking: 'Arya is talking — tap to end',
}

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<VoiceSession | null>(null)
  const turnsRef = useRef<Turn[]>([])

  async function persistTranscript(sessionId: string) {
    try {
      await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, transcript: turnsRef.current }),
        keepalive: true,
      })
    } catch {
      // Best-effort from the client.
    }
  }

  async function toggleSession() {
    setError(null)
    if (sessionRef.current) {
      const { sessionId } = sessionRef.current
      sessionRef.current.end()
      sessionRef.current = null
      await persistTranscript(sessionId)
      return
    }
    try {
      turnsRef.current = []
      sessionRef.current = await startVoiceSession({
        onStatus: setStatus,
        onTranscript: (role, content) => {
          // Captured for persistence only — deliberately not rendered.
          turnsRef.current.push({ role, content, timestamp: new Date().toISOString() })
        },
        onError: setError,
      })
    } catch (cause) {
      setStatus('idle')
      setError((cause as Error).message)
    }
  }

  useEffect(() => {
    const onClose = () => {
      if (sessionRef.current) {
        void persistTranscript(sessionRef.current.sessionId)
        sessionRef.current.end()
      }
    }
    window.addEventListener('pagehide', onClose)
    return () => window.removeEventListener('pagehide', onClose)
  }, [])

  const live = status !== 'idle'
  return (
    <main>
      <div className="header">
        <h1>Arya</h1>
        <span className={`pill ${status}`}>{status}</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="stage">
        <button
          className={`orb ${status}`}
          aria-label={live ? 'End voice session' : 'Start voice session'}
          onClick={() => void toggleSession()}
        >
          🎙️
        </button>
      </div>
      <p className="hint">{HINTS[status]}</p>
    </main>
  )
}
