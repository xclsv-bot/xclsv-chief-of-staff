# Arya — XCLSV Media Chief of Staff Agent

An executive-assistant agent over Gmail, Slack, Zoom, and Asana for Zaire Williams.
Arya triages email into the Email GPS label system, posts Slack digests, turns batched
voice memos into reply drafts in Zaire's voice, nudges stale threads, digests Zoom calls
into routed action items, and works tasks assigned to her in Asana.

- **Authoritative spec:** `docs/build-spec.md` (v1.3)
- **Builder instructions:** `CLAUDE.md`
- **Arya's brain (runtime instruction files):** `agent/`

v1 is draft-only by design: Arya never sends email, never deletes anything, and every
outbound artifact passes a Slack approval gate. See the trust ladder in spec §9.

## Runbook

### Stage 1 — Scaffold + spec + agent instruction files

**What landed:** repo structure per `CLAUDE.md`, the spec in `docs/`, `agent/ARYA.md`
(soul file, verbatim from the spec appendix), and first drafts of `label-taxonomy.md`,
`triage-rules.md`, `arya-scope.md`, `nudge-rules.md`, plus a placeholder
`voice-profile.md` (real one is generated in stage 5).

**How to verify:** read the `agent/` files against spec §3, §4, §8, §12 — they should
restate the spec, not contradict it. `data/` must be gitignored (`git check-ignore data/x`
should match). No code runs yet.

**How to roll back:** revert the commit; there is no runtime state.

**Tuning:** Zaire edits `agent/*.md` directly — the VIP list in `triage-rules.md` is
expected to change during shadow labeling.

### Stage 2 — Gmail connector + triage pipeline (shadow labeling)

**What landed:** `src/connectors/gmail.ts` (draft-only connector: list/read threads,
ensure + apply GPS labels, archive — no send or delete code path exists, enforced by
`tests/gmail-guard.test.ts`), `src/state.ts` (SQLite at `data/state.db`),
`src/pipelines/classify.ts` (LLM classifier prompted with `agent/ARYA.md` +
`label-taxonomy.md` + `triage-rules.md` loaded at runtime), and
`src/pipelines/triage.ts` (the hourly sweep). Mechanical calls — Zaire-replied-last →
3-Waiting, inbound-on-3-Waiting → reclassify + nudge reset, already-triaged → skip —
are deterministic code; only judgment calls go to the model. 3-Waiting is never
assigned by the model.

**How to run:**

```
./scripts/setup.sh                # deps, data/, .env from template
npm run auth:gmail                # once: prints the Gmail refresh token for .env
npm run sweep -- --dry-run        # logs intended labels, touches nothing
npm run sweep                     # shadow labeling: label writes ON, nothing else
```

Scope note: Gmail's scope granularity can't express "labels + drafts but not send" —
the connector uses `gmail.modify` (the narrowest usable scope) and the no-send/no-delete
rule is enforced structurally in code and by the guard tests.

For the hourly cadence (7am–7pm PT, spec §2), schedule externally, e.g. cron:
`0 7-19 * * * cd <repo> && npm run sweep`.

**How to verify:** `npm test` (deterministic layer, label mutual exclusivity, no-send
guard, state store, fixture coverage — no network). `npm run test:eval` runs the 24
judgment fixtures against the live API (needs `ANTHROPIC_API_KEY`; costs a few cents).
During shadow labeling days 1–4, spot-check Gmail against the pass criteria in spec
§11: >90% of 1-Respond genuinely needs Zaire; zero partner/deal-flow email buried in
2-Review or archived.

**How to roll back:** stop the cron entry; labels are plain Gmail labels (removable in
Gmail, or delete them entirely); `rm data/state.db` resets all agent state. Archived
threads are recoverable from All Mail — nothing is ever deleted.

### Stage 3 — Slack bot + twice-daily digest

**What landed:** `src/connectors/slack.ts` (post digest, threaded replies, one-line
failure alerts) and `src/pipelines/digest.ts` (spec §4: Needs You / Ready Nudges /
Flags, capped at 10 oldest-first with "+N more", skipped when empty, Friday-only
2-Review rollup). Digest item numbers are unique across sections and persisted in the
`digests` table so the stage-4 voice grammar can resolve "item 3" against the exact
digest Zaire is answering. The classifier now writes the one-line digest text
("Luis / Outlier — asking to confirm September slate scope") at triage time, in Arya's
digest style from `ARYA.md`. Triage sweep failures now post a single alert line to
Slack instead of stderr. Ready Nudges lists stale threads now; the pre-written nudge
drafts attach in stage 6.

**Slack app setup (once):** create an app in the workspace, add bot scopes
`chat:write` and `channels:history` (history is read in stage 4 for reactions/voice
notes), install to the workspace, invite the bot to `#inbox-gps`, and put the bot
token + channel ID in `.env` (`SLACK_BOT_TOKEN`, `SLACK_INBOX_GPS_CHANNEL_ID`).

**How to run:**

```
npm run digest -- --dry-run       # prints the digest to stdout, posts nothing
npm run digest                    # posts to #inbox-gps (skips silently if empty)
```

Schedule at 8:00 AM and 3:00 PM PT (spec §2), e.g. cron with `TZ=America/Los_Angeles`:
`0 8,15 * * * cd <repo> && npm run digest`.

**How to verify:** `npm test` covers ordering, the 10-item cap and overflow note,
cross-section numbering, snooze exclusion, the 3-business-day nudge threshold,
2nd-nudge escalation to Flags, and the Friday rollup. Then a `--dry-run` against a
populated `data/state.db` should read like spec §4's example.

**How to roll back:** stop the digest cron entry — labeling continues unaffected.
Digest posts are plain Slack messages; deleting them loses nothing (state lives in
`data/state.db`).

### Stage 4 — Voice memo → parse → draft → approval gate

**What landed:** `src/pipelines/memo.ts` (the `#inbox-gps` poller), `src/pipelines/draft.ts`
(draft generation + mechanical hard-rule backstops), `src/transcribe.ts` (Whisper on
Slack voice notes — the plumbing shared with the Agenda Agent), and Gmail reply-draft
creation (`drafts.create` with proper In-Reply-To threading — still no send path).

The loop (spec §5–7): Zaire replies to a digest in Slack — batched voice memo or text.
The poller transcribes, parses the voice-command grammar per item (Tell/Reply, Push,
Skip, Archive, Delegate, Nudge) against the stored digest numbering, and executes:
replies/delegations/nudges become drafts posted as threaded replies (header line first,
so a wrong-thread draft is visually obvious), snoozes set resurface dates, archives hit
Gmail. A ✅ reaction from Zaire finalizes the draft in Gmail Drafts on the correct
thread and confirms "Draft ready in Gmail — send when ready." A further reply with
changes supersedes and regenerates. Nothing is ever auto-approved; drafts pending past
24h surface in the digest's Flags section.

**Guardrails in code, not vibes:** only messages from `ZAIRE_SLACK_USER_ID` are parsed
as instructions (hard rule 5). The numbers rule has a mechanical backstop —
`validateDraft` regex-scans every draft for dollar figures/percentages/`50k`-style
tokens not present in Zaire's memo and warns loudly in the approval post, plus a
wrong-recipient check against thread participants. Ambiguous instructions produce a
"Did you mean #2 or #5?" question, never a guess; later memos win per item; duplicate
actions on an already-handled item get "already handled at [time]."

**Slack app additions (once):** add bot scopes `files:read` and `reactions:read`
(alongside `chat:write`, `channels:history`), reinstall the app, and set
`ZAIRE_SLACK_USER_ID` (Slack profile → ⋯ → Copy member ID) and `OPENAI_API_KEY`
(Whisper) in `.env`.

**How to run:**

```
npm run inbox -- --dry-run        # transcribes + parses, prints intended actions
npm run inbox                     # executes: posts drafts, applies ✅ approvals
```

Poll every few minutes during working hours, e.g. cron (`TZ=America/Los_Angeles`):
`*/5 7-19 * * * cd <repo> && npm run inbox`.

**How to verify:** `npm test` (grammar parsing, later-wins, business-day snooze math,
numbers-rule backstop, recipient guard, MIME threading, draft state machine, stale-draft
flags). End-to-end: reply to a digest with "reply to 1 — tell them yes" as text, watch
the draft appear in-thread, react ✅, and find the draft in Gmail Drafts on the right
thread. Voice path: same, as a Slack voice note.

**How to roll back:** stop the inbox cron entry. Pending drafts are just Slack posts +
DB rows; Gmail drafts created by approvals are visible in the Drafts folder and can be
discarded by hand (the agent itself never deletes). `data/state.db` remains the single
source of state.

## Repo layout

See the layout block in `CLAUDE.md`. Behavior lives in `agent/` (markdown, tuned by
editing text); plumbing lives in `src/` (built in stages 2–7). `data/` (corpus,
embeddings, state DB) is created at runtime and never committed.
