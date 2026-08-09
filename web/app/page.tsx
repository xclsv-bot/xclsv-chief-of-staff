'use client'

// Mic button + session transcript (spec §9). WebRTC wiring lands in step 5 —
// this skeleton renders the full UI shell with the session inert.

import { useState } from 'react'

export type SessionStatus = 'idle' | 'connecting' | 'listening' | 'speaking'

export default function Home() {
  const [status] = useState<SessionStatus>('idle')

  return (
    <main>
      <div className="header">
        <h1>Arya</h1>
        <span className={`pill ${status}`}>{status}</span>
      </div>
      <div className="transcript" />
      <button className="mic" aria-label="Start voice session" disabled>
        🎙️
      </button>
      <p className="hint">Voice session wiring lands in build step 5.</p>
    </main>
  )
}
