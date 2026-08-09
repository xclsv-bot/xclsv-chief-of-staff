// Zoom connector — READ-ONLY (spec §2): pulls cloud-recording transcripts via
// Server-to-Server OAuth. No calendar writes, no meeting controls, no deletes.
// Poll-based (fits the scheduled-runs architecture): call_ingest.ts lists
// recent recordings instead of receiving webhooks.

export interface ZoomRecording {
  meetingUuid: string
  topic: string
  startTime: string
  transcriptUrl: string | null
}

export async function zoomToken(
  accountId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
    },
  )
  if (!res.ok) throw new Error(`Zoom auth failed: ${res.status}`)
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('Zoom auth returned no token')
  return data.access_token
}

interface RawRecordingFile {
  file_type?: string
  download_url?: string
}

interface RawMeeting {
  uuid?: string
  topic?: string
  start_time?: string
  recording_files?: RawRecordingFile[]
}

export async function listRecordings(
  token: string,
  fromDate: string,
): Promise<ZoomRecording[]> {
  const res = await fetch(
    `https://api.zoom.us/v2/users/me/recordings?from=${fromDate}&page_size=30`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!res.ok) throw new Error(`Zoom recordings list failed: ${res.status}`)
  const data = (await res.json()) as { meetings?: RawMeeting[] }
  return (data.meetings ?? []).map((m) => ({
    meetingUuid: m.uuid ?? '',
    topic: m.topic ?? 'Untitled call',
    startTime: m.start_time ?? '',
    transcriptUrl:
      m.recording_files?.find((f) => f.file_type === 'TRANSCRIPT')?.download_url ?? null,
  }))
}

export async function downloadTranscript(url: string, token: string): Promise<string> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`Zoom transcript download failed: ${res.status}`)
  return res.text()
}

/** Flatten a WEBVTT transcript to "Speaker: line" text (pure, testable). */
export function parseVtt(vtt: string): string {
  return vtt
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== '' &&
        line !== 'WEBVTT' &&
        !/^\d+$/.test(line) &&
        !line.includes('-->'),
    )
    .join('\n')
}
