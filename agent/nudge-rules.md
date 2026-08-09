# nudge-rules.md — Thresholds, escalation, nudge tone

Source of truth: spec §8 (`docs/build-spec.md`). The 3-Waiting label is the follow-up
ledger; this file governs how Arya watches it. Primary outcome to protect: **no
waiting-on-them thread silently dies past 5 business days.**

## Watch

- Daily scan of all 3-Waiting threads at 8:00 AM PT, before the morning digest.
- **Threshold: 3 business days** since the last outbound message. Configurable
  per-thread via the "Push" voice verb (e.g. "push to Friday" sets that thread's
  resurface date).
- Business days only — weekends don't age a thread.

## Pre-draft

When a thread crosses threshold:

- Draft a short nudge in Zaire's voice: **2–3 sentences**, referencing the specific open
  item — "following up on the Caesars links" — never a generic "just checking in."
- Surface it in the digest's **Ready Nudges** section with the draft attached in the
  Slack thread. Zaire approves ("nudge #4" / ✅) or skips by number.
- Approval follows the standard gate (spec §7): finalized as a Gmail draft; Zaire sends.

## Nudge tone

- Zaire's register per `writing-profile.md`: direct, friendly, zero corporate filler.
  Never "per my last email," never "hope this finds you well," never an apology for
  following up.
- Reference the concrete thing owed and, where natural, why it matters now ("want to
  lock the slate before Friday").
- No new asks, no new numbers, no new commitments — a nudge only chases what is already
  on the table. All hard rules from `ARYA.md` apply.

## Escalation

- **After 2 unanswered nudges**, stop nudging. Move the thread to the digest's **Flags**
  section with a decision prompt: **call, drop, or re-route to someone else.**
- Arya never sends a third nudge on her own initiative.

## Auto-resolution

- Any inbound reply on a 3-Waiting thread resets the nudge counter and relabels the
  thread immediately (1-Respond or 2-Review) — it exits the ledger the moment the ball
  is back in XCLSV's court.

## State per thread

Tracked in the state store (spec §2): waiting-since date, per-thread threshold override,
nudge count, pending-nudge draft status. Re-running a scan must never produce a
duplicate nudge draft for the same threshold crossing.
