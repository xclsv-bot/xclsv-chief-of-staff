'use client'

// Mic button + session transcript (spec §9). Tap to start a session, tap again
// to end it. Transcript turns append as OpenAI Realtime reports them; the full
// transcript persists on session end (build step 12).

import { useEffect, useRef, useState } from 'react'
import { startVoiceSession, type VoiceSession } from '@/lib/webrtc'

type Status = 'idle' | 'connecting' | 'listening' | 'speaking'
interface Turn {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export default function Home() {
  const [status, setStatus] = useState<Status>('idle')
  const [turns, setTurns] = useState<Turn[]>([])
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<VoiceSession | null>(null)
  const turnsRef = useRef<Turn[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    turnsRef.current = turns
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns])

  async function persistTranscript(sessionId: string) {
    try {
      await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, transcript: turnsRef.current }),
        keepalive: true,
      })
    } catch {
      // Transcript persistence is best-effort from the client.
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
      setTurns([])
      sessionRef.current = await startVoiceSession({
        onStatus: setStatus,
        onTranscript: (role, content) =>
          setTurns((prev) => [
            ...prev,
            { role, content, timestamp: new Date().toISOString() },
          ]),
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
      <div className="transcript" ref={scrollRef}>
        {turns.map((turn, index) => (
          <div key={index} className={`turn ${turn.role}`}>
            {turn.content}
          </div>
        ))}
      </div>
      <button
        className={`mic ${live ? 'live' : ''}`}
        aria-label={live ? 'End voice session' : 'Start voice session'}
        onClick={() => void toggleSession()}
      >
        {live ? '⏹' : '🎙️'}
      </button>
      <p className="hint">{live ? 'Tap to end the session' : 'Tap to talk to Arya'}</p>
    </main>
  )
}
