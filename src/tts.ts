// Text-to-speech for the audio digest — ElevenLabs. Optional plumbing: the
// digest pipeline attaches audio only when ELEVENLABS_API_KEY is configured,
// and a TTS failure never blocks the text digest.

const DEFAULT_MODEL = 'eleven_multilingual_v2'

export async function synthesize(
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<Buffer> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: DEFAULT_MODEL }),
    },
  )
  if (!res.ok) {
    throw new Error(`TTS failed: ${res.status} ${await res.text()}`)
  }
  return Buffer.from(await res.arrayBuffer())
}
