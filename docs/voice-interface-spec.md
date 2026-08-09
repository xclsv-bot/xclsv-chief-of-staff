XCLSV Media — Build Spec

**Chief of Staff Agent "Arya" v1.4: Realtime Voice Interface**

Owner: Zaire Williams • Platform: Claude Code agent • Interface: OpenAI Realtime API (voice) + existing Chief-of-Staff codebase • Draft date: August 9, 2026 • Status: Ready for build

---

## 1. Overview & Goals

Add a real-time voice interface to the existing Chief-of-Staff Arya (`~/clawd/chief-of-staff/`) so Zaire can talk to Arya from his phone or laptop the same way he'd talk to ChatGPT Advanced Voice Mode. Voice becomes a sibling entry point to the existing text/#inbox-gps flow, not a replacement.

The voice layer is a thin front-door. All state, memory, drafts, and executive logic remain in the existing codebase. Zaire's voice session can read today's digest, dictate replies, file tasks, and hand off async work to the poller-driven pipelines that already run.

**Primary outcomes:**
1. Zaire opens a URL on his phone, taps the mic, talks to Arya, hears responses.
2. Every meaningful voice action mutates the same SQLite state the text pipeline uses.
3. Full session transcripts are stored so nothing said aloud is lost.

**Explicit non-goals for v1:**
- No native mobile app. It's a PWA installed to home screen.
- No sending email from voice. Voice creates *drafts* only, same rule as v1.3.
- No multi-user support. Zaire only. Shared-secret auth on the URL.
- No voice-driven approvals of pending drafts in v1. Approvals still happen via ✅ reaction in the Slack approval thread. (See §12.)
- No streaming corrections mid-response ("wait, change that"). Turn-based only.

---

## 2. Architecture

**Front-end:** A Next.js 15 (App Router) PWA served at `voice.chief-of-staff.internal` (Vercel deploy). Single page with a large mic button and a session transcript. Installs to iOS/Android home screen via manifest.

**Transport:** WebRTC direct from the browser to `api.openai.com/v1/realtime`. The browser mints an ephemeral client secret via our backend (`POST /api/session`) then opens the peer connection directly. Audio flows peer-to-peer over WebRTC; tool calls flow back through our backend via the data channel.

**Backend:** Two API routes in the same Next.js app:
1. `POST /api/session` — mints an ephemeral OpenAI Realtime session with the Arya system prompt, tool schemas, and voice config. Returns the client secret to the browser.
2. `POST /api/tool-call` — receives function-call payloads forwarded by the browser (relay pattern), executes them against the Chief-of-Staff internals, returns the result string. This is what makes Arya's voice sessions actually *do* things.

**Voice model:** `gpt-4o-realtime-preview` (or the newest realtime model available at build time; verify with `curl https://api.openai.com/v1/models | jq '.data[] | select(.id | contains("realtime"))'`).

**Voice:** `sage` (default). Swap by changing `VOICE_ID` env var — no code change needed. Zaire has said he does not care about voice sound; `sage` is picked as a neutral, assistant-appropriate default.

**Session lifecycle:**
1. User taps mic → browser calls `POST /api/session` with shared-secret cookie.
2. Backend calls OpenAI Realtime, gets ephemeral token, returns to browser.
3. Browser opens WebRTC peer connection to OpenAI using that token.
4. User talks. OpenAI Realtime handles VAD + STT + LLM + TTS.
5. On function-call events, browser POSTs to `/api/tool-call`. Backend executes, returns result. Browser writes result back into the OpenAI session via the data channel.
6. Session ends when user closes tab or explicitly ends. Full transcript persisted.

**Why WebRTC (not WebSocket):** WebRTC is the recommended transport for Realtime API from browsers — lower latency, native audio handling, automatic reconnection. WebSocket is server-to-server only in practice.

---

## 3. Directory Layout

New folder inside the existing repo:

```
chief-of-staff/
├── src/
│   └── voice/
│       ├── session.ts       # OpenAI Realtime session builder
│       ├── tools.ts         # Tool schemas + handler dispatch
│       ├── handlers/
│       │   ├── read_digest.ts
│       │   ├── create_draft.ts
│       │   ├── create_task.ts
│       │   └── search_email.ts   # send_slack_note.ts retired 2026-08-09 (§5.4)
│       └── transcript.ts    # Persists session transcripts to SQLite
└── web/                     # Next.js 15 App Router PWA
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx         # Mic button UI
    │   └── api/
    │       ├── session/route.ts
    │       └── tool-call/route.ts
    ├── lib/
    │   ├── webrtc.ts        # WebRTC client wrapper
    │   ├── auth.ts          # Shared-secret cookie check
    │   └── tools-shim.ts    # Imports from ../../src/voice/tools.ts
    ├── public/
    │   ├── manifest.json
    │   └── icon-512.png
    ├── package.json
    ├── next.config.mjs
    └── tsconfig.json
```

The `web/` folder is a separate Next.js project with its own `package.json` but resolves imports back into `../src/voice/` via relative paths. This keeps the voice tool handlers in the same TypeScript module system as the rest of the Chief-of-Staff code so they can `import { StateStore } from '../../src/state.js'` etc.

Deployment: `web/` deploys to Vercel. The backend at `/api/*` bundles the tool handlers into serverless functions. Vercel automatically picks up the folder.

---

## 4. Environment Additions

Append to `.env.example` and `.env`:

```
# Voice interface (Aug 2026)
OPENAI_REALTIME_MODEL=gpt-4o-realtime-preview-2024-12-17
VOICE_ID=sage
VOICE_SHARED_SECRET=<generate 32 random bytes hex>
VOICE_APP_URL=https://arya-voice.vercel.app
```

`OPENAI_API_KEY` already exists (used for Whisper). Reuse it.

`VOICE_SHARED_SECRET` gates access to the app. The URL becomes `https://arya-voice.vercel.app/?k=<secret>` and the shared secret is stored as an HttpOnly cookie after first successful load.

---

## 5. Tool Schemas & Handlers

Each tool is a small function that returns a string (or JSON-stringified object) that the model reads back to the user. Keep responses under 200 words so voice playback stays snappy.

### 5.1 `read_todays_digest`

```typescript
{
  name: 'read_todays_digest',
  description: 'Read today\'s inbox digest — items Zaire needs to respond to, ready nudges, and flags. Use when Zaire asks "what\'s on my plate?" or "what does my day look like?"',
  parameters: {
    type: 'object',
    properties: {
      section: {
        type: 'string',
        enum: ['all', 'needs_you', 'ready_nudges', 'flags'],
        description: 'Which section to read. Default: needs_you.',
      },
    },
  },
}
```

**Handler:** Queries `StateStore.digestsSince(today)`, formats the most recent digest into a spoken paragraph. Example return: `"You have four items needing your response. One: Luis from Outlier asking to confirm September slate scope, waiting three days. Two: Andrea at NFL Bullseye Group with the Buccaneers posting reply. Three: ..."`

Wire to existing code: `import { StateStore } from '../../state.js'`.

### 5.2 `create_draft`

```typescript
{
  name: 'create_draft',
  description: 'Create an email reply draft in Zaire\'s Gmail for a specific thread. Use when Zaire says "reply to X saying Y" or "draft a response to that thread."',
  parameters: {
    type: 'object',
    properties: {
      digest_item_number: {
        type: 'integer',
        description: 'The number Zaire referenced (e.g., "#2 in today\'s digest"). Preferred over thread_id when available.',
      },
      thread_id: {
        type: 'string',
        description: 'Gmail thread ID. Only use if digest_item_number is not available.',
      },
      instruction: {
        type: 'string',
        description: 'What Zaire said the reply should convey. Pass through his actual words as much as possible — the draft generator adapts them into his written voice.',
      },
    },
    required: ['instruction'],
  },
}
```

**Handler:** Calls `makeDraft()` from `src/pipelines/draft.ts` (the shared draft composer). Persists the draft with `StateStore.createDraft()`. Returns: `"Draft ready for thread [subject]. It's pending your approval in Slack — check the #inbox-gps thread."`

### 5.3 `create_task`

```typescript
{
  name: 'create_task',
  description: 'File a task in Asana assigned to Arya (you). Use when Zaire says "remind me to X," "put on the list Y," or "I need you to Z."',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short task title.' },
      description: {
        type: 'string',
        description: 'Full context Zaire gave. Include any deadlines, links, or people mentioned.',
      },
      due_date: {
        type: 'string',
        description: 'ISO date YYYY-MM-DD if Zaire specified one. Null otherwise.',
      },
    },
    required: ['title', 'description'],
  },
}
```

**Handler:** New file. Uses Asana REST API with the token from `TOOLS.md` ("Asana Token (Arya)"). Creates the task in Zaire's workspace (`1124866853726882`), assigned to Arya's GID (`1213058747989990`). Returns: `"Filed: [title]. Due [date or 'no due date']."`

Env addition: `ASANA_TOKEN` (already effectively available in `TOOLS.md`, formalize in `.env`).

### 5.4 `send_slack_note` — **removed 2026-08-09**

Originally routed long dictations from voice into `#inbox-gps` for the memo
pipeline (`src/pipelines/memo.ts`) to process on its next run. That pipeline
was deleted when the voice PWA took over intake; `create_draft` now handles
composed replies directly in the same session. Kept in the spec as a header
so `5.5` / `5.6` numbering doesn't shift silently.

### 5.5 `search_email`

```typescript
{
  name: 'search_email',
  description: 'Search Zaire\'s Gmail for a specific topic, person, or thread. Use when Zaire asks "what did X say?" or "when did we last talk to Y?"',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Gmail search syntax. Examples: "from:andrea tailgate", "subject:MLR after:2026/07/01".',
      },
      max_results: {
        type: 'integer',
        description: 'Cap on returned threads. Default 5.',
      },
    },
    required: ['query'],
  },
}
```

**Handler:** Uses existing `gmailClient` from `src/connectors/gmail.ts`. Returns a spoken summary: `"Three threads match. One: Andrea, August 6, subject 'Brand Ambassador Job Posting'. Two: ..."`. Include a one-sentence extract from each.

### 5.6 Handler dispatch

`src/voice/tools.ts` exports:

```typescript
export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'read_todays_digest': return readTodaysDigest(args)
    case 'create_draft': return createDraft(args)
    case 'create_task': return createTask(args)
    case 'search_email': return searchEmail(args)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}
```

Each handler catches its own errors and returns a friendly voice-appropriate error string (`"Couldn't reach Asana just now, tell me again in a minute and I'll retry."`) rather than throwing.

---

## 6. System Prompt

Built dynamically per session in `src/voice/session.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function buildVoiceSystemPrompt(): string {
  const agentDir = join(process.cwd(), 'agent')
  const files = {
    scope: readFileSync(join(agentDir, 'arya-scope.md'), 'utf8'),
    triage: readFileSync(join(agentDir, 'triage-rules.md'), 'utf8'),
    feedback: readFileSync(join(agentDir, 'feedback-log.md'), 'utf8'),
  }
  return [
    files.scope,
    '---',
    files.triage,
    '---',
    files.feedback,
    '---',
    '# Current interface: voice conversation with Zaire',
    '',
    'You are talking to Zaire live over voice. Keep responses short — under 30 seconds spoken (roughly 60 words) unless he asks for detail. He is likely mobile (driving, walking, mid-task).',
    '',
    'When he gives you work, use tools. Never say "I\'ll take care of that" without actually calling the tool that files it. If the tool fails, say so.',
    '',
    'When he asks "what\'s on my plate," call read_todays_digest first, then summarize aloud. Do not invent items.',
    '',
    'When he dictates a reply to an email, call create_draft with his exact intent. The draft goes to Gmail Drafts + posts in Slack for text approval — tell him that so he knows where to find it.',
    '',
    'When he says "remind me to X" or "add to the list," call create_task.',
    '',
    'For ambiguity, ask ONE short clarifying question. Do not launch into options unless he asked for them.',
  ].join('\n\n')
}
```

This is the same brain-loading pattern the other pipelines use (`draft.ts` and friends). Any correction Zaire has ever logged in `feedback-log.md` applies to voice sessions too.

---

## 7. Session Endpoint (`POST /api/session`)

`web/app/api/session/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { buildVoiceSystemPrompt } from '../../../../src/voice/session'
import { toolSchemas } from '../../../../src/voice/tools'

export async function POST(request: Request) {
  const authed = await checkAuth(request)
  if (!authed) return new NextResponse('Unauthorized', { status: 401 })

  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_REALTIME_MODEL,
      voice: process.env.VOICE_ID, // 'sage' by default
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

  const data = await response.json()
  return NextResponse.json({
    client_secret: data.client_secret.value,
    expires_at: data.client_secret.expires_at,
  })
}
```

---

## 8. Tool-Call Endpoint (`POST /api/tool-call`)

`web/app/api/tool-call/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { checkAuth } from '@/lib/auth'
import { executeToolCall } from '../../../../src/voice/tools'
import { persistToolCall } from '../../../../src/voice/transcript'

export async function POST(request: Request) {
  if (!(await checkAuth(request))) return new NextResponse('Unauthorized', { status: 401 })

  const { session_id, call_id, name, arguments: args } = await request.json()

  try {
    const result = await executeToolCall(name, args)
    await persistToolCall({ sessionId: session_id, callId: call_id, name, args, result })
    return NextResponse.json({ output: result })
  } catch (error) {
    const message = (error as Error).message
    await persistToolCall({ sessionId: session_id, callId: call_id, name, args, error: message })
    return NextResponse.json({ output: `Tool failed: ${message}` })
  }
}
```

---

## 9. Front-end (`web/app/page.tsx`)

Minimum viable:

- Big circular mic button, dead-center.
- Below: a scrolling transcript of the current session (user turns + assistant turns interleaved).
- Above: "Arya" title + a session-status pill (idle / listening / speaking).
- Ends session on tab close or explicit "End" button.

WebRTC wrapper (`web/lib/webrtc.ts`) handles:

1. `POST /api/session` for ephemeral token.
2. `new RTCPeerConnection()` + `getUserMedia({ audio: true })`.
3. Set up data channel `oai-events` for JSON events.
4. `pc.createOffer()` → send SDP to `https://api.openai.com/v1/realtime?model=<MODEL>` with `Authorization: Bearer <ephemeral>`.
5. Set remote description from the SDP response.
6. On data-channel `message`: if event is `response.function_call_arguments.done`, POST args to `/api/tool-call`, then push result back into the session via `conversation.item.create` + `response.create`.
7. On data-channel `message`: if event is `response.audio_transcript.done` or `conversation.item.input_audio_transcription.completed`, append to transcript state.

Reference: https://platform.openai.com/docs/guides/realtime-webrtc

---

## 10. Auth

`web/lib/auth.ts`:

```typescript
import { cookies } from 'next/headers'

export async function checkAuth(request: Request): Promise<boolean> {
  const url = new URL(request.url)
  const key = url.searchParams.get('k') ?? (await cookies()).get('arya_secret')?.value
  return key === process.env.VOICE_SHARED_SECRET
}
```

First page load: if `?k=<secret>` matches, set HttpOnly cookie `arya_secret` and redirect to `/`. Subsequent visits use the cookie. Zaire bookmarks the URL once with the query string, PWA installs, cookie persists.

---

## 11. Transcript Persistence

`src/voice/transcript.ts` extends the existing `StateStore` with two new tables:

```sql
CREATE TABLE IF NOT EXISTS voice_sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  transcript TEXT   -- JSON array of {role, content, timestamp}
);

CREATE TABLE IF NOT EXISTS voice_tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
```

The `persistToolCall()` and `persistTranscript()` helpers write to these. Sessions get logged so that (a) Zaire can review what he said and I did, (b) future model iterations can learn from prior voice sessions, (c) misfires are debuggable.

---

## 12. Explicit Non-goals & Deferred Features

Not in v1:
- **Voice approval of pending drafts.** Approving still happens in Slack via ✅. This is intentional. Voice makes it too easy to mis-approve a draft you haven't read.
- **Voice cutoff / barge-in.** Wait for the response to finish. `turn_detection: server_vad` handles user-initiated turns cleanly.
- **Voice-to-voice back-and-forth across sessions.** Each session is standalone. State persists (in Gmail, Asana, SQLite) but there's no "resume last conversation."
- **Multi-language.** English only.
- **Native iOS/Android app.** PWA is enough.

Deferred to v1.5+ (write as future work in `feedback-log.md`):
- Approve drafts by voice with a re-read-back confirmation gate.
- Call Arya via a real phone number (Twilio + OpenAI SIP or ElevenLabs Phone Numbers).
- Multiple concurrent voice sessions (for when Anna or others get a voice interface).
- ElevenLabs voice re-cloning if Zaire wants the exact digest-narrator voice.

---

## 13. Testing Plan

**Manual smoke tests (before shipping):**
1. Open URL on desktop Chrome. Verify mic permission prompt. Say "hello Arya, what's on my plate today?" Confirm read_todays_digest fires and returns real digest items.
2. Say "remind me to email Andrea about Broncos on Monday." Confirm Asana task created with due 2026-08-10 (or whichever next Monday).
3. Say "draft a reply to item three saying we'll go with the Buccaneers as the pilot." Confirm draft appears in Gmail Drafts + Slack post.
4. Install as PWA on iOS. Confirm mic works from home-screen icon.
5. Close tab mid-response. Confirm session ends cleanly, transcript persists.

**Unit tests (`tests/voice.test.ts`):**
- `executeToolCall` dispatch matches every tool name.
- Each handler returns a string under 500 chars for successful paths.
- Auth rejects missing / wrong secret.

**Regression:** Voice-generated drafts must land in the same `drafts` table used by every other producer (`call_ingest`, `triage`) so the Slack approval gate stays the single choke point. Reactions in the approval thread apply uniformly regardless of which pipeline created the draft.

---

## 14. Sequenced Build Order

For the executing Claude Code agent — do these in order, commit after each.

1. **Env + docs.** Add new env vars to `.env.example`. Update `README.md` with a "Voice interface" section pointing to this spec.

2. **Skeleton `web/`.** `pnpm create next-app@latest web --typescript --tailwind --app --src-dir --import-alias "@/*"`. Add manifest.json + icon-512.png. Deploy to Vercel behind auth. Verify PWA installs.

3. **Auth.** Implement `checkAuth` + cookie set on first `?k=...` visit. Verify wrong secret returns 401.

4. **Session endpoint.** Implement `POST /api/session` with the OpenAI Realtime API call. Verify curl returns an ephemeral token.

5. **Front-end WebRTC.** Wire mic button to `webrtc.ts`. Verify audio connects to OpenAI and voice responses play back (no tools yet).

6. **Tool infrastructure.** Create `src/voice/tools.ts` + `src/voice/session.ts`. Wire the system prompt from agent files. Add empty handler stubs that return `"Not implemented yet"`.

7. **Tool: `read_todays_digest`.** Implement first. Verify voice: "what's on my plate?" reads back real digest items.

8. **Tool: `create_task`.** Implement second. Verify voice: "add task X" creates an Asana task.

9. **Tool: `create_draft`.** Implement third. Verify voice-dictated draft appears in Gmail Drafts.

10. **Tool: `send_slack_note`.** ~~Implement fourth.~~ Retired 2026-08-09 alongside the memo pipeline — see §5.4. Skip this step.

11. **Tool: `search_email`.** Implement fourth. Verify search results read back.

12. **Transcript persistence.** Add tables to `StateStore`. Wire `/api/tool-call` to log every call.

13. **Tests + docs.** Add smoke tests. Update `agent/feedback-log.md` with "voice interface online" entry so future-me knows this exists.

14. **Deploy final + hand URL to Zaire.**

---

## 15. Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Ephemeral token leaks in browser network tab | Expected — ephemeral tokens are short-lived (60s) and scoped to a single session. This is the documented pattern. |
| Zaire dictates a wrong Asana task and can't undo by voice | Every task creation returns the Asana URL in the spoken confirmation, and gets logged in `voice_tool_calls`. Manual delete from Asana. |
| Voice model hallucinates a digest item that doesn't exist | System prompt hard rule: never invent items. `read_todays_digest` is the source of truth. Watch first sessions closely. |
| PWA mic permissions revoked silently on iOS | User-visible error banner on session start failure. |
| WebRTC connection fails behind restrictive network | Fall back to a "we couldn't reach the voice service" message. Log the error server-side. |
| Cost | OpenAI Realtime is ~$0.06/min audio input + $0.24/min output. A 10-minute session ≈ $2. Cap sessions at 30 min with an auto-warning at 25. |

---

## 16. Success Criteria

v1 ships when:
- [ ] Zaire can open the PWA on his phone and complete a 5-minute conversation covering: reading the digest, filing 2 tasks, dictating 1 draft.
- [ ] All 5 tools execute successfully at least once.
- [ ] Transcripts persist and are readable from `data/state.db`.
- [ ] `pnpm typecheck` passes in both `chief-of-staff/` and `chief-of-staff/web/`.
- [ ] `feedback-log.md` has an entry marking voice online + any corrections from the first live session.

**Definition of not-yet-done:** if Zaire has to pull out his laptop to fix something the voice interface should've handled, that's a bug — capture it as a Correction in `feedback-log.md` and iterate.
