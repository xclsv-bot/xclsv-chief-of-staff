// Transcript persistence (v1.4 spec §11) — best-effort writers over the shared
// state DB. A logging failure must never break a live voice session.

import { openState } from './context.js'

export async function persistToolCall(entry: {
  sessionId: string
  callId: string
  name: string
  args: unknown
  result?: string
  error?: string
}): Promise<void> {
  const store = openState()
  if (!store) return
  try {
    store.logVoiceToolCall({
      sessionId: entry.sessionId,
      callId: entry.callId,
      toolName: entry.name,
      args: entry.args,
      result: entry.result,
      error: entry.error,
    })
  } catch (error) {
    console.error('voice tool-call logging failed:', error)
  } finally {
    store.close()
  }
}

export async function persistTranscript(
  sessionId: string,
  transcript: { role: string; content: string; timestamp: string }[],
): Promise<void> {
  const store = openState()
  if (!store) return
  try {
    store.saveVoiceTranscript(sessionId, transcript)
  } catch (error) {
    console.error('voice transcript persistence failed:', error)
  } finally {
    store.close()
  }
}
