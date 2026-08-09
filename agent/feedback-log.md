# feedback-log.md — Corrections ledger

Running log of Zaire's corrections and the rules they became (ARYA.md: "turn
corrections into rules"). Loaded into every voice session (v1.4 spec §6) and
into the text pipeline's system prompts, so a correction logged once applies
everywhere. Newest entries first.

Two formats coexist below — the short milestone/rule format for structural
events, and the longer inline-correction format used during live triage
sessions. Both are loaded verbatim into system prompts.

---

## 2026-08-09 — Voice interface online (v1.4)

Correction: n/a — milestone entry so future sessions know this exists.
Rule: Zaire can now reach Arya by voice (PWA → OpenAI Realtime → the same
state, drafts, and approval gates as the text pipeline). Voice cannot approve
drafts in v1 (spec §12); deferred wishlist lives in the spec — voice approval
with read-back confirmation, a real phone number, multi-session.

---

## 2026-08-09 — First live digest review

**Context:** First live sweep + digest posted to #inbox-gps at 12:24 AM EDT.
100 threads processed → 56 Archive / 16 1-Respond / 9 2-Review / 4 3-Waiting.

### Correction 1: "Needs You" — no split, keep wide net
> "for Needs you these should be VIPs and other new leads or insights."
> "lets not make the change 1, because there may be some emails that need me
> that aren't in my VIPs"

**Resolution:** No structural change to Section A. Zaire wants the wide net —
non-VIP threads can still genuinely need him. Filtering to VIP-only would risk
burying real asks under the fold.

**Real fix is Correction 2:** tighten Archive so fewer spam/cold-outbound items
even reach 1-Respond in the first place. Then "Needs You" naturally becomes what
it should be.

**No rule file updated.**

### Correction 2: Spam still hitting 1-Respond
> "We are going to have to work on removing spam emails."

**Observed:** Multiple cold outbound pitches landed in 1-Respond (low confidence)
instead of Archive — e.g. "Invitation for Zaire" (capital pitch), "About Exclusive
Media" (coaching vendor), several unknown-sender pitches. The current tie-breaker
("Respond beats Archive") is over-conservative on pure cold outbound.

**Rule file updated:** `triage-rules.md` — new "Cold-outbound archive signals"
section listing patterns that override the low-confidence default (unknown
sender + no XCLSV/iGaming relevance + boilerplate pitch structure = Archive).

**Open follow-up:** As Zaire flags misses in the digest, add sender-specific rules
here. Goal: get low-confidence 1-Respond down to genuine ambiguity only.

### Correction 3: too_thin task handling — search first, ping Slack (not Asana)
> "I would want you to do a search in my gmail for 40love agency. I would want
> you to shoot me a slack about something like this instead of responding in
> Asana or reassigning to me."

**Trigger:** First live Asana test — task "Follow up with 40 love agency" with
notes "read her email and draft a follow up letting them know we are still
waiting for a response from the partner." I classified `too_thin` and posted a
clarifying comment on the Asana task itself.

**Two changes required:**

1. **Search Gmail before declaring too_thin.** Extract entity names from the task
   (agency, person, company) and run a targeted Gmail search *before* asking. In
   this case "40 Love" would likely surface the sender's email + which partner
   thread they're referencing, letting me re-interpret as `plan` instead of
   `too_thin`.

2. **Clarifying questions go to Slack DM, not Asana comments.** Z wants task-
   related clarifications in the same channel where digests live — the DM. Asana
   comments are noisy and easy to miss. The Slack ping should reference the
   Asana task (title + link) so he can act from either surface.

**Rule files updated (this session):**
- `agent/ARYA.md` — hard rule "you ask rather than guess" refined to
  "search first, then ask via Slack if still stuck. Never post clarifying
  questions as Asana comments."
- `agent/arya-scope.md` — task-pickup workflow updated to: (a) entity-extract,
  (b) Gmail search, (c) re-interpret, (d) if still too thin → Slack DM.

**Code change required (follow-up):** `src/pipelines/asana_router.ts` needs
a Gmail-search enrichment step before `interpretTask` returns `too_thin`, plus
route clarifying questions through `postMessage` to `SLACK_INBOX_GPS_CHANNEL_ID`
instead of `addComment`. State store still records status = 'clarify' so the
digest surfaces it as a flag. Deferring to next session — this is a real code
change that needs testing, not a late-night patch.

**Manual proof of concept (this session):** Ran the Gmail search Z described and
posted the correct clarifying question to Slack DM, to demonstrate what the
router SHOULD do once patched.

### Correction 3a: Slack clarifying-question format — tight, no context dump
> "Can you show me what you would send in Slack to me after I added that asana task?
> you don't have to give me the context of what you found. Instead you should just
> slack me something like: 'in regards to the task you assigned me to follow up with
> 40 love, do you want me to name the brand / tailgate partner or keep it generic?'"
>
> Z's response after I showed the tight version: **"yes exactly."**

**Refinement:** My first proof-of-concept DM in this session dumped the full Gmail
search results (agency, thread, last email dates, my interpretation, the question).
That's the *investigation*, not the *ask*. Z wants the DM to be the one-line ask —
he trusts I did the search, he doesn't need to see the work.

**Locked format (also in `arya-scope.md`):**

> In regards to the task you assigned me to [one-phrase description] (<Asana link>) — [one specific question]?

**Why:** the DM is the ping, not the briefing. Context-dump DMs = digest bloat and
harder to scan. If Z wants the context, he'll ask.

**Rule file updated:** `agent/arya-scope.md` — task-pickup workflow step 4 now
includes the exact format template + a "what NOT to do" line.

### Correction 3b: No em dashes. Also: run the voice corpus.
> "Have you been able to review my sent emails to get a framework for tone and email
> structure? you added a '-' and I don't want you to use that"

**Two things surfaced at once:**

1. **Em dash ("—") is a personal no.** I opened the 40 Love draft with "Quick update —
   still working through..." That em dash is my default writing tic, not Z's. He does
   not use them and does not want them in his outbound.

2. **The voice corpus has not been run yet.** `voice-profile.md` is still the
   hand-written placeholder stub. Every draft I've produced has been from generic
   instructions + whatever tone I could infer inline from the thread I pulled. Z
   correctly flagged that this is why my style drifts from his.

**Immediate actions (this session):**
- Redrafted the 40 Love reply without em dashes (v2 draft in Gmail; original v1 draft
  can be deleted manually — the connector deliberately exposes no delete path).
- Added the em-dash rule to `agent/voice-profile.md` under "Global defaults" so it's
  binding even before the corpus lands.
- Added a script-level guard to future one-off drafts (`if body.includes('—') throw`)
  as a belt-and-suspenders check while I retrain my defaults.

**Deferred (needs Z's kickoff):**
- Run `npm run corpus` against Z's sent mail (last 365 days). Writes
  `data/voice-profile.generated.md` as a CANDIDATE — Z reviews it and promotes to
  `agent/voice-profile.md` himself (spec §6 + CLAUDE.md). This is what should have
  been done before any drafting happened, and it's on me for not surfacing it earlier.

**Watch-list of my other likely tics (audit these against the corpus once it runs):**
- Em dashes ("—") ❌ confirmed no
- Sentence-opener "Quick update," / "Quick note,"
- Trailing "Appreciate the patience." / "Appreciate it."
- Filler openers like "Just wanted to..."
- Any use of "circle back" if Z doesn't say it (he did in his Jul 21 reply to Steph,
  so this one is probably safe — but confirm)

### Correction 3c: No forced line breaks mid-paragraph in email bodies
> "the format of the email you were going to send to 40 love is also off a little.
> Instead of using 'return' button and adding the next sentence on a new line, you
> can keep it more natural."

**Observed:** In v1/v2 of the 40 Love draft, I hard-wrapped each paragraph at ~80
characters — inserting `\n` between "back with final numbers yet, so nothing new to
share on the / gap you flagged." That reads as a machine-formatted email (like an old
plaintext mailing list). Real humans let the email client soft-wrap at whatever width
the reader is viewing.

**Rule:** In email bodies drafted via `createReplyDraft` / `createDraftMessage`, each
paragraph is a single unbroken string. Use `\n\n` **only** between paragraphs; never
`\n` inside one. The MIME layer + Gmail client will handle wrapping.

**Applied:**
- v3 draft rewritten as single-line paragraphs.
- One-off drafting scripts now include a per-paragraph guard: `if (p.includes('\n'))
  throw new Error('hard line break inside paragraph')`.
- Rule added to `agent/voice-profile.md` under "Global defaults."

**Downstream code note (pending):** The main pipeline path
(`src/pipelines/memo.ts` → `finalizeApproval` → `createReplyDraft`) passes `draft.body`
straight through. Whatever model generates that body needs the same instruction in
its system prompt: "paragraphs are single lines; only `\n\n` between paragraphs." Add
this next time I'm editing the draft-generation prompt.

### Correction 3d: Slack "done" confirmations should close Asana tasks (router only watches Asana comments today)
> "I sent the email to 40 love, so you can mark the asana task as complete"

**Observed:** The router's completion detection lives in `src/pipelines/asana_router.ts`
lines 231–248: it lists comments on Arya's tasks and looks for one from Zaire matching
`/\b(done|complete|approved|shipped)\b/i`. Only then does it add the closing comment
and call `completeOwnTask`. There is no Slack-side listener, so Z's "you can mark the
task complete" in DM is invisible to the router.

**Manual today:** Ran `addComment` + `completeOwnTask` + `store.upsertAryaTask({status:
'done'})` as a one-off. Same three steps the router would have run.

**Code change required (pending):** The router should also poll for Zaire's Slack DM
messages since the last run that reference an open Arya task (by title match or by
`asana.com/.../task/<gid>` link) and contain a completion phrase. Two ways this could
be wired:

1. **Pull:** each `asana` cron run fetches new messages from `SLACK_INBOX_GPS_CHANNEL_ID`
   after the last-seen ts and cross-references against open Arya tasks. Cheap but
   lagged by up to the cron interval.
2. **Push:** Slack Events API `message.im` → a lightweight web handler → same close-out
   logic. Zero lag but adds a service to maintain.

Pull is the right first move (matches the current cron model, no new infra). Deferred
to next session with the other router changes (Gmail-search enrichment for `too_thin`
and Slack DM instead of Asana comment for clarifications). Bundle them into a single
router refactor pass.

---

## 2026-08-09 — Second live session (Andrea recruiting task)

### Correction 3e: Router should surface reply activity on Arya's drafted threads
> "should you cc yourself in these emails? So that you see responses and can handle them?"
>
> My answer (paraphrased): No, don't CC — I already have read access to Z's full inbox
> via the chief-of-staff OAuth, and CC-ing arya@ would leak a visible AI address to
> external contacts. The *actual* gap is that the router doesn't currently notify me
> when a reply lands on a thread I drafted.
>
> Z's follow-up: "Can we make the update to the pending router refactor list like you
> suggested? You can do that in the repo."

**Observed:** Today I drafted a reply to Andrea (thread `19fd7ab8448fb166`, Asana task
`1211905821708237`). When Andrea replies, right now there is no automated hook that
pulls that reply into my visibility — I'd have to be explicitly re-pinged by Z, or
manually poll the thread. That defeats the "invisible assistant" pattern we picked
over CC-ing arya@.

**Rule:** Router must track the Gmail thread(s) associated with each Arya task and,
on each run, check for new inbound messages on those threads since the last-seen
timestamp. New messages should:

1. Get flagged in the digest under a new "Replies on your tasks" subsection.
2. Optionally trigger a re-interpretation of the task (was the reply a completion
   signal? a follow-up ask? a rejection?) so the classifier can update the task's
   status without a human tapping me on the shoulder.

**Storage change required:** `AryaTaskRecord` in `data/state.db` currently tracks
`{taskGid, status, draftId?}`. Add `threadIds: string[]` — populated when the router
creates a reply draft, so subsequent runs know which threads to poll.

**Code change required (pending):** New step in `src/pipelines/asana_router.ts` after
the existing task-list step: for each open task with `threadIds`, fetch messages via
`gmail.users.threads.get({ id: threadId })`, compare against the last known
`historyId` (or last message id we saw), and emit a "reply landed" event into the
digest pipeline.

**Bundle with:** the three items in Corrections 3, 3a, and 3d — single router
refactor pass.

---

## Pending router refactor — consolidated punch list

All four items below get done in a single refactor pass on `src/pipelines/asana_router.ts`
(and its storage layer). Ordered by dependency, not priority.

1. **Gmail-search enrichment before `too_thin`** (Correction 3, 2026-08-09 session 1).
   Entity-extract task title/notes → Gmail search → re-interpret before returning
   `too_thin`. Prevents unnecessary clarifying pings.

2. **Clarifying questions via Slack DM, not Asana comments** (Correction 3a,
   2026-08-09 session 1). Route `too_thin` outputs through `postMessage` to
   `SLACK_INBOX_GPS_CHANNEL_ID` using the locked one-line format:
   `"In regards to the task you assigned me to [X] (<Asana link>) — [one question]?"`
   Currently calls `addComment` on the Asana task, which Z has said is noisy.

3. **Slack "done" listener** (Correction 3d, 2026-08-09 session 1). Pull messages
   from `SLACK_INBOX_GPS_CHANNEL_ID` since last run, match completion phrases
   (`/\b(done|complete|approved|shipped|sent)\b/i`) against open Arya tasks (by
   title fuzzy-match or by `asana.com/.../task/<gid>` link in the message), and
   fire `completeOwnTask` + closing comment when found.

4. **Reply-activity surfacing on Arya's drafted threads** (Correction 3e, 2026-08-09
   session 2). Track `threadIds` per `AryaTaskRecord`; each run, poll those threads
   for new inbound messages and flag them in the digest. Prevents needing to CC
   arya@ on outbound drafts.

**Shared prep work for the pass:**
- Add `threadIds: string[]` to `AryaTaskRecord` schema (item 4).
- Add `lastSlackTs: string` to the router's state key (items 2, 3).
- Extend digest schema with two new subsections: "Clarifying questions I'm sending
  Z" (item 2) and "Replies on your tasks" (item 4).
