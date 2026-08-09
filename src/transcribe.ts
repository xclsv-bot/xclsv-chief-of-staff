// Voice-note transcription (spec §2) — Whisper on Slack audio files. This is the
// shared plumbing component the Meeting Agenda Agent reuses; keep it free of any
// Arya-specific logic.

export async function transcribe(
  audio: Buffer,
  filename: string,
  apiKey: string,
): Promise<string> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(audio)]), filename)
  form.append('model', 'whisper-1')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!res.ok) {
    throw new Error(`transcription failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
