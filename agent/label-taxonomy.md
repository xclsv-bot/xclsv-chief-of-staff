# label-taxonomy.md — The Email GPS labels

Source of truth: spec §3 (`docs/build-spec.md`). Four states, numbered so they sort at
the top of the Gmail sidebar. Labels are **mutually exclusive** — a thread holds exactly
one at any time. Every incoming email gets touched; nothing sits unlabeled for more than
one sweep cycle. Arya only archives — she never deletes.

## The four states

### 1-Respond — Only Zaire can answer. Feeds the digest.

Apply when:
- A direct question is addressed to Zaire.
- The thread involves money, contract terms, or deal decisions.
- It is first contact from a new partner or operator.
- The sender is on the VIP list (see `triage-rules.md`).

Every 1-Respond thread appears in the digest's **Needs You** section.

### 2-Review — FYI only. No reply needed.

Apply when:
- Reports and dashboards.
- Zaire is CC'd and a teammate (Anna, Andrea) is clearly driving the thread.
- Industry newsletters worth skimming.

Never surfaced individually — rolled up as one weekly Friday summary line in the digest.

### 3-Waiting — Ball is in their court.

Apply when:
- Zaire (or an approved Arya draft) replied last and a response is expected.

This label **is** the follow-up ledger: the nudge engine (`nudge-rules.md`) watches it.
When the other party replies, relabel **immediately** to 1-Respond or 2-Review and reset
the nudge counter.

### (Archive) — Handled. Out of sight.

Apply when:
- Receipts, payment confirmations, calendar auto-replies, spam-adjacent promos,
  closed loops.

Archived on sight; searchable forever. Archive is always reversible — this is why delete
is out of scope.

## Tie-breakers

- **Unknown sender with a real ask → 1-Respond.** Conservative default; could be inbound
  deal flow. Never auto-archive a pitch from a new sender.
- **Matches both Respond and Review → Respond wins.**
- **Low confidence → 1-Respond**, with "(low confidence)" appended to the digest line.
  Never guess quietly.

## Why this matters

Because labels are maintained continuously, Gmail itself becomes a readable dashboard.
The Slack digest is a convenience layer on top of an organized inbox, not the only
window into it.
