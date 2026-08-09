XCLSV Media — Build Spec

**Chief of Staff Agent “Arya” v1.3: Email GPS, Voice Follow-Ups, Zoom Digest & Two-Way Asana**

Owner: Zaire Williams • Platform: Claude Code agent • Interfaces: Gmail + Slack + Zoom + Asana • Draft date: August 8, 2026 • Status: Ready for build

**1. Overview & Goals**

A single agent — named **Arya** — that acts as an executive-assistant layer over Gmail, Zoom, and Asana. Arya keeps the inbox continuously organized using an Email GPS label system (adapted from *Buy Back Your Time*, Dan Martell), surfaces a short daily digest of threads that genuinely need Zaire, converts one batched voice memo into per-thread reply drafts written in his voice, automatically prepares follow-up nudges for threads where XCLSV is waiting on the other party, digests Zoom calls into action items, routes Zaire-owned items into Asana, and — over time — becomes an addressable point of contact (arya@ mailbox) that partners can email directly for logistics, with Zaire CC'd. Arya identity, Zoom ingestion, and Asana routing are specified in Sections 12–14.

**Primary outcomes:** (1) Zaire never works from a raw inbox — only from the 1-Respond queue or the Slack digest. (2) An inbox session takes under 10 minutes via one voice memo. (3) No waiting-on-them thread silently dies past 5 business days.

**Explicit non-goals for v1:** the agent never sends email, never deletes email, and never makes relationship or deal judgments. It prepares; Zaire decides.

**Companion system:** the Meeting Agenda Agent (separate spec) shares the same Slack voice-note plumbing (channel listener + transcription). Build the shared plumbing once.

**2. Architecture**

- **Agent core:** Claude Code agent with scheduled runs. Instruction files kept in repo: label-taxonomy.md, triage-rules.md, writing-profile.md, voice-conduct.md, nudge-rules.md.

- **Gmail connector (v1 scopes):** read, modify labels, archive, create drafts. **No send scope. No delete scope.** Sending is manual (from Gmail) in v1 — see Section 9. Applies to both Zaire's mailbox and the Arya mailbox.

- **Arya mailbox:** dedicated Google Workspace account (e.g., arya@xclsvmedia.com) that the agent monitors and drafts from. Zaire is CC'd on all Arya outbound. Phased external exposure per Section 12.

- **Zoom connector (read-only):** pulls cloud-recording transcripts via Zoom API webhook when a recording completes (or a meeting-bot service if webhook access is limited). No calendar writes, no meeting controls. See Section 13.

- **Asana connector:** create tasks and add comments only. Never completes, edits, or deletes existing tasks in v1. See Section 14.

- **Slack bot:** dedicated channel \#inbox-gps. Posts digests as top-level messages; each draft is a threaded reply; approvals via emoji reactions; revisions via threaded voice notes or text. Additionally: history-read scope on Zaire-designated channels/DMs to feed the voice corpus (Section 6.1).

- **Transcription:** Whisper (or equivalent) on Slack voice-note files, same component as the Agenda Agent.

- **State store:** lightweight JSON/SQLite keyed by Gmail thread ID: current label, waiting-since date, nudge count, draft status (none / pending approval / approved / revised), Slack message refs.

- **Schedules:** labeling sweep hourly (7am–7pm PT); digest posts at 8:00 AM and 3:00 PM PT; nudge scan daily at 8:00 AM before the digest.

**3. Email GPS Labeling Engine**

Four states. Numbered labels so they sort at the top of the Gmail sidebar. The agent touches every incoming email; nothing sits unlabeled for more than one sweep cycle. Labels are mutually exclusive. The agent only archives — it never deletes.

|               |                                          |                                                                                                                                                                                                                                                      |
|---------------|------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Label**     | **Meaning**                              | **Triage rules & examples**                                                                                                                                                                                                                          |
| **1-Respond** | Only Zaire can answer. Feeds the digest. | Direct question addressed to Zaire; any thread involving money, contract terms, or deal decisions; first contact from a new partner/operator; anything from a defined VIP list (e.g., key operator contacts, MLR, active deal counterparties, Tony). |
| **2-Review**  | FYI only. No reply needed.               | Reports and dashboards; threads where Zaire is CC'd and a teammate (Anna, Andrea) is clearly driving; industry newsletters worth skimming. Never surfaced individually — rolled up in one weekly Friday summary line in the digest.                  |
| **3-Waiting** | Ball is in their court.                  | Zaire (or the agent's approved draft) replied last and a response is expected. This label IS the follow-up ledger: the nudge engine (Section 8) watches it. When the other party replies, the agent immediately relabels to 1-Respond or 2-Review.   |
| **(Archive)** | Handled. Out of sight.                   | Receipts, payment confirmations, calendar auto-replies, spam-adjacent promos, closed loops. Archived on sight; searchable forever. Archive is always reversible — this is why delete is out of scope.                                                |

**Tie-breakers:** unknown sender with a real ask → 1-Respond (conservative default). A thread that matches both Respond and Review → Respond wins. When confidence is low, the agent labels 1-Respond and appends “(low confidence)” in the digest line rather than guessing quietly.

**Benefit worth stating in onboarding:** because labels are maintained continuously, Gmail itself becomes a readable dashboard. The Slack digest is a convenience layer on top of an organized inbox, not the only window into it.

**4. Daily Digest Format**

Posted to \#inbox-gps at 8:00 AM and 3:00 PM PT. Skipped if empty. Capped at 10 items (oldest-first overflow noted as “+N more in 1-Respond”). Three sections:

**A. Needs You** — every 1-Respond thread. One line each, numbered for voice reference:

3\) Luis / Outlier — asking to confirm September slate scope — waiting 3d — \[link\]

**B. Ready Nudges** — 3-Waiting threads past threshold, each with a pre-written follow-up already drafted (Section 8). Approve or skip by number.

**C. Flags** — unapproved drafts older than 24h, threads on their 2nd unanswered nudge, and (Fridays only) the 2-Review weekly rollup count.

**5. Voice-Command Grammar**

One batched voice memo replies to a digest. Zaire references items by number or name. The agent splits the transcript per item and applies one verb per item:

|                              |                                                                                                                                        |
|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| **Verb pattern**             | **Agent behavior**                                                                                                                     |
| “Tell / Reply to X…”         | Draft a reply to that thread carrying the stated content (Section 6). Default verb if intent is clearly a response.                    |
| “Push / Snooze \[to Fri\]”   | Remove from digest; resurface on the stated date (default: 3 business days). Label unchanged.                                          |
| “Skip”                       | Leave as-is; reappears in the next digest. Also the default for any item not mentioned in the memo.                                    |
| “Archive”                    | Archive the thread; drop from state.                                                                                                   |
| “Delegate to Anna / Andrea…” | Draft a forward to the named teammate with a 2–3 line context summary and the stated instruction. Goes through the same approval gate. |
| “Nudge / Send the follow-up” | Approve the pre-drafted nudge for that Ready Nudges item.                                                                              |

**Ambiguity rule:** if an instruction can't be confidently matched to exactly one item (e.g., “tell him yes” when two threads have open yes/no questions), the agent does not guess. It replies in-thread: “Did you mean \#2 (Lucas/MLR terms) or \#5 (Rebet banner)?” and waits. If two memos arrive before processing, the later instruction wins per item.

**6. Draft Generation & Voice Corpus**

Arya learns Zaire's voice from his actual communication history rather than a static style guide. Two mechanisms work together: a distilled style profile built once from the corpus, and live per-thread retrieval of his real past emails as few-shot examples at draft time.

**6.1 Voice corpus build (one-time, then refreshed monthly)**

- **Sources:** Gmail Sent folder, trailing 12 months (read scope already granted); Slack message history from channels/DMs Zaire designates (requires a Slack history-read scope — added to the connector list). Slack supplies the internal register; email supplies the partner registers.

- **Processing:** cluster sent messages by recipient type and situation — established partner, new contact, internal team, nudge/follow-up, scheduling, declining/deferring — and distill each cluster into writing-profile.md: observed greeting/closing norms, typical length, formality per relationship, characteristic phrasings, and how Zaire actually handles common situations (how he says no, how he chases, how he defers a number).

- **Exclusions:** Zaire can list threads, contacts, or keywords excluded from the corpus (e.g., legal, capital, personal). Excluded material is never retrieved as an example.

- **Refresh:** monthly re-run so the profile tracks how his voice evolves; the profile file remains human-readable and directly editable.

**6.2 Per-thread retrieval at draft time**

When drafting, Arya retrieves the strongest available precedent, in priority order: (1) Zaire's past emails **to this exact contact** — the ground truth for that relationship's tone; (2) his emails handling **the same situation type** with similar contacts; (3) the distilled writing-profile.md as fallback for novel contacts. Retrieved examples condition style only — tone, structure, length — never content: facts, numbers, and commitments in old emails are precedent for **how** Zaire writes, not for **what** this draft may claim.

**Hard rules (encoded as constraints, not suggestions):**

- Never state a dollar figure, percentage, date commitment, or contract term that was not explicitly spoken in the memo — including any that appear in retrieved historical emails. If the reply seems to need one, insert \[ZW: confirm number\] and flag it in the Slack post.

- Never make a new promise or concession on Zaire's behalf; the draft can acknowledge, answer what was stated, and defer (“let me confirm and come back to you”).

- Reply in-thread (correct Gmail thread), matching the thread's existing tone and language.

- Every Slack draft post begins with a header line — recipient, company, thread subject — so a wrong-thread interpretation is visually obvious before approval.

**7. Approval Gate**

1.  Agent posts each draft as a threaded Slack reply under the digest item, header line first, draft body below.

2.  Zaire reacts **✅** to approve or replies in-thread (voice or text) with changes — revision loop until ✅.

3.  **v1 behavior on approval:** the agent finalizes the draft in Gmail Drafts, attached to the correct thread, and confirms in Slack: “Draft ready in Gmail — send when ready.” The agent has no send scope; the human click to send is the final control.

4.  Drafts unapproved after 24h appear in the next digest's Flags section. Nothing is ever auto-approved by timeout.

**Permanent gate:** threads involving money, contract terms, or a first-touch to a new relationship keep the full approval gate in every future version — these never move to auto-send, even in v2+.

**8. 3-Waiting Nudge Engine**

- **Watch:** daily scan of 3-Waiting. Default threshold: 3 business days since last outbound (configurable per thread via “Push”).

- **Pre-draft:** a short nudge in Zaire's voice (2–3 sentences, references the specific open item — “following up on the Caesars links”), surfaced in the digest's Ready Nudges section. Approving follows Section 7.

- **Escalation:** after 2 nudges with no response, the thread moves to Flags with a decision prompt: call, drop, or re-route to someone else. The agent never sends a third nudge on its own initiative.

- **Auto-resolution:** any inbound reply on a 3-Waiting thread resets the counter and relabels immediately.

**9. v1 Boundaries & the Trust Ladder**

|                                                                  |                      |                             |                                                                                               |
|------------------------------------------------------------------|----------------------|-----------------------------|-----------------------------------------------------------------------------------------------|
| **Capability**                                                   | **v1**               | **v2**                      | **Graduation criteria**                                                                       |
| Read, label, archive                                             | Yes                  | Yes                         | —                                                                                             |
| Create reply drafts                                              | Yes (approval-gated) | Yes                         | —                                                                                             |
| Send approved drafts on ✅                                       | No — manual send     | Yes                         | 4 consecutive weeks with zero wrong-thread or hard-rule violations                            |
| Auto-send logistics-only nudges                                  | No                   | Optional, per-thread opt-in | v2 stable for 4 weeks; logistics classifier reviewed                                          |
| Money / contract / first-touch sends                             | Never auto           | Never auto                  | Permanent human gate                                                                          |
| Zoom transcript ingestion + call digest                          | Yes (read-only)      | Yes                         | —                                                                                             |
| Create Asana tasks from calls/email                              | Yes (creation only)  | Yes                         | Creation is reversible; no edit/complete/delete                                               |
| Arya replies to partners who email her directly (logistics only) | No                   | No — v3                     | v2 auto-send stable 4+ weeks; identity posture confirmed w/ counsel; Zaire CC'd on every send |
| Delete email                                                     | Never                | Never                       | Archive is the terminal state                                                                 |

**10. Edge Cases**

- **Contracts & attachment-heavy threads:** label 1-Respond with a “needs reading” tag in the digest; the agent does not auto-draft substantive replies to legal documents.

- **Unknown new sender with a pitch:** 1-Respond, low-confidence flag; never auto-archived (could be inbound deal flow).

- **Zaire replies directly in Gmail:** agent detects the sent reply on next sweep, relabels to 3-Waiting, and cancels any pending draft for that thread.

- **Gmail API failure / rate limit:** retry with backoff; if a full sweep fails, post one alert line in Slack rather than failing silently.

- **Duplicate digest actions:** if Zaire acts on a stale digest (item already resolved), the agent replies “already handled at \[time\]” instead of double-drafting.

**11. Rollout Plan & Definition of Done**

Build effort is 2–4 dev-days. The rollout is one week, because v1 is draft-only by design — the approval gate is the safety mechanism, so features do not need to be staged on top of it. The only stage that needs calendar time is shadow labeling, which needs enough email volume to verify triage accuracy.

1.  **Days 1–4 — Shadow labeling:** agent labels only; no digest, no drafts. Zaire spot-checks Gmail a couple of times a day. Pass criteria before Day 5: \>90% of 1-Respond items genuinely need him; zero partner or deal-flow emails buried in 2-Review or auto-archived. Tune VIP list and triage rules as needed.

2.  **Day 5 — Everything live at once:** digest, voice replies, drafting, approval gate, and nudge engine all switch on together. Worst case in week one is a bad draft that never gets approved — that is feedback, not risk.

**Definition of done (v1):** no unlabeled email older than one sweep cycle; a full inbox session (digest → memo → approvals) takes under 10 minutes; no 3-Waiting thread exceeds 5 business days without a surfaced nudge; zero sends by the agent.

**The four-week window — reframed:** four consecutive clean weeks (zero wrong-thread drafts, zero hard-rule violations) is not a rollout schedule; it is the graduation criterion for v2 auto-send in Section 9 — the only point where an irreversible action enters the system. Keep a simple weekly counter (threads triaged, drafts approved vs. revised, nudges sent) as the evidence base for that decision and, per the Buyback Rate logic, the record of hours actually bought back.

**12. Arya: Named Assistant Identity & Email Presence**

The agent operates under a single named identity — **Arya** — with her own mailbox. The goal is to shift routine coordination off Zaire's inbox entirely: over time, partners send logistics to Arya instead of Zaire, and Zaire stays CC'd rather than on point.

**12.1 Mailbox & identity rules**

- Dedicated Google Workspace account (e.g., arya@xclsvmedia.com). Same v1 scope rules as Zaire's mailbox: draft-only, no send scope, no delete.

- **Zaire is CC'd on every Arya outbound, in every version, permanently.** This is not a trust-phase rule — it is how he keeps ambient awareness without being the bottleneck.

- **Identity posture:** Arya presents as Zaire's chief of staff — signature: “Arya · Chief of Staff · XCLSV Media.” She does not volunteer that she is an AI. Two hard lines: (1) if asked directly whether she is an AI or a person, she answers truthfully and briefly, then moves on; (2) she never implies humanity — no invented personal texture, no claimed call/meeting availability. Requests for a call route to Zaire naturally (“Zaire handles calls — let me find you time with him”). Note: given CA bot-disclosure law and the regulated iGaming context, confirm this posture with counsel before Phase C (partners emailing Arya directly).

- **Arya's lane (encoded in** arya-scope.md**):** scheduling, document/asset requests and delivery, status updates, event logistics, reporting cadence, intro coordination. **Never in Arya's lane:** pricing, contract terms, deal negotiation, capital conversations. Anything in that category gets a one-line handoff (“looping in Zaire on this”) and is labeled 1-Respond in Zaire's queue.

**12.2 Phased external exposure**

1.  **Phase A (v1) — Internal only:** Arya's mailbox exists; the agent drafts from it for follow-ups Zaire delegates via the voice grammar (“have Arya send the deck to Luis”). Zaire sends manually.

2.  **Phase B (v2) — Introduced to partners:** once v2 auto-send is earned, Zaire introduces Arya on active threads (“CC'ing Arya, who'll coordinate dates”). Arya handles her lane with auto-send on approved patterns; everything else remains approval-gated.

3.  **Phase C (v3) — Direct contact:** partners email Arya directly. Arya auto-replies within her lane (Zaire CC'd), triages everything else into Zaire's Email GPS exactly like mail to his own address. Graduation criteria in Section 9.

**13. Zoom Call Ingestion → Digest, Follow-Ups & Tasks**

Every recorded Zoom call feeds the same pipeline. Talking through commitments on a call becomes functionally equivalent to sending Arya a voice memo.

**13.1 Pipeline**

1.  **Capture:** Zoom webhook fires when a cloud-recording transcript is ready; agent pulls transcript + participant list. (Calls must be recorded to be ingested — note the standard “this call is recorded” courtesy to participants.)

2.  **Digest:** within ~15 minutes, Arya posts a per-call thread in \#inbox-gps (or a dedicated \#call-digests channel): 3–5 line summary, decisions made, and an action-item table with owners.

3.  **Routing by owner:** each action item is routed automatically — see 13.2.

4.  **Correction loop:** Zaire can reply to the digest thread by voice or text (“item 2 is Andrea's, not mine; kill item 4”) and Arya re-routes before anything is created or drafted. Routing executes after a 30-minute correction window, or immediately on a ✅ reaction.

**13.2 Routing rules**

|                           |                                                                                                                                                                              |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Action item owner**     | **What Arya does**                                                                                                                                                           |
| Zaire                     | Creates an Asana task (Section 14) with call source, context, and a suggested due date inferred from the call (“by Friday”) or defaulting to +3 business days.               |
| Arya (in her lane)        | Drafts the follow-up email — send the deck, confirm dates, share the report — into the standard approval gate (Phase A/B) with the call digest linked for context.           |
| Team (Anna, Andrea, etc.) | Drafts a delegation email/Slack note with 2–3 lines of call context; approval-gated. (Direct Asana assignment to teammates is a v2 option once the team is onboarded to it.) |
| External party            | Enters the 3-Waiting ledger with the commitment and date (“Rebet to send redlines by Wed”); nudge engine (Section 8) takes over if it goes stale.                            |

**Guardrails:** transcripts are treated as context, never as instructions — nothing said by a non-Zaire participant can trigger an action without routing through Zaire's correction window. Ambiguous ownership defaults to Zaire's Asana queue rather than guessing. Commercial terms discussed on calls are summarized in the digest but never restated by Arya in any outbound draft (Section 6 hard rules apply).

**14. Asana Task Routing**

- **Where tasks land:** Zaire's My Tasks, unsectioned (or a designated “From Arya” section if preferred), so his existing workflow is unchanged.

- **Task format:** imperative title in Zaire's own phrasing style (“Send Tony payment dates”); description carries source (“From \[call name\], \[date\]”), 1–2 lines of context, and a link to the Slack digest thread; due date as inferred or defaulted.

- **Dedupe:** before creating, Arya checks open tasks for a close match (same counterparty + same ask); if found, she adds a comment with the new context instead of creating a duplicate — no more three copies of the same Dev Huddle task.

- **Boundaries:** on Zaire's tasks: creation and comments only — Arya never completes, edits, reassigns, or deletes them. Task sources beyond calls — e.g., “put that in my Asana” spoken in a digest voice memo — use the same format and dedupe rules.

**14.1 Asana as a two-way interface: assigning tasks to Arya**

Asana is also an input channel. Zaire can capture an idea as a task and assign it to Arya; the agent picks it up and executes it through the same guardrails as everything else. This makes task capture location-independent — a thought typed into the Asana mobile app is equivalent to a voice memo in Slack.

- **Arya's Asana identity:** a guest/member seat under arya@xclsvmedia.com so tasks can be assigned to her natively. The agent polls her My Tasks every 15 minutes during working hours.

- **Pickup & interpretation:** on pickup, Arya comments on the task with her reading of it and the intended plan (“Interpreting this as: draft an intro email from you to X — will post the draft in Slack for approval”). That comment is the checkpoint: if the interpretation is wrong, Zaire replies on the task and she re-plans.

- **Clearance rules — unchanged by channel:** a task assigned to Arya grants her the work, not the send. Anything that produces an outbound email, message, or external artifact routes through the standard approval gate (Section 7) exactly as if it originated from a voice memo. Lane rules (Section 12.1) still apply: a task asking her to negotiate terms gets a comment — “outside my lane, routing back to you” — and a 1-Respond flag in the digest.

- **Ambiguity:** if the task is too thin to act on (“follow up w/ that guy”), Arya asks one clarifying question as a task comment and surfaces it in the next digest's Flags section. She never guesses on thin instructions.

- **Completion & reporting:** Arya may mark complete only tasks assigned to her, and only after the deliverable is done — which for gated work means Zaire approved and the send occurred. Her closing comment links the artifact (sent email, updated doc, Slack thread). Zaire-assigned-to-Zaire tasks remain untouchable.

- **Status visibility:** any Arya task open more than 3 business days without progress appears in the digest's Flags section — she is subject to her own nudge engine.

