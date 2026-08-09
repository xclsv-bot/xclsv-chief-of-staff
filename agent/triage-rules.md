# triage-rules.md — Classification rules, VIP list, digest format

Source of truth: spec §3, §4, §10 (`docs/build-spec.md`). Labels themselves are defined
in `label-taxonomy.md`; this file governs how to apply them and how the digest is built.

## Sweep cadence

- Labeling sweep: hourly, 7am–7pm PT.
- Nudge scan: daily at 8:00 AM PT, before the morning digest.
- Digest posts: 8:00 AM and 3:00 PM PT to #inbox-gps. Skipped if empty.

## VIP list (always 1-Respond)

Anything from these senders lands in 1-Respond regardless of content:

- Key operator contacts (DraftKings, FanDuel, BetMGM, Caesars, Fanatics, Rebet,
  Polymarket — active points of contact)
- MLR (exclusive affiliate partnership)
- Active deal counterparties
- Tony

> Zaire: edit this list directly — add names/addresses one per line. It is tuned during
> shadow labeling (rollout days 1–4) and whenever a triage miss shows up.

## Classification order

For each new or updated thread:

1. **Inbound reply on a 3-Waiting thread?** Relabel immediately (1-Respond or 2-Review)
   and reset the nudge counter.
2. **Zaire replied directly in Gmail?** Relabel to 3-Waiting and cancel any pending
   draft for that thread.
3. **VIP sender?** → 1-Respond.
4. **Money, contract terms, or deal decisions anywhere in the thread?** → 1-Respond.
5. **Direct question to Zaire, or first contact from a new partner/operator?** → 1-Respond.
6. **Archive-on-sight material** (receipts, payment confirmations, calendar auto-replies,
   spam-adjacent promos, closed loops)? → Archive.
7. **FYI material** (reports, dashboards, CC'd threads a teammate is driving,
   newsletters)? → 2-Review.
8. **Anything left, or confidence low?** → 1-Respond with "(low confidence)" in the
   digest line. Respond beats Review on any tie.

## Cold-outbound archive signals

The default "unknown sender → 1-Respond (low confidence)" tie-breaker is
over-conservative. Override it and **Archive** when *all* of the following are true:

1. **Unknown sender** — no prior thread in Zaire's mailbox, not on the VIP list,
   sender domain has no history with XCLSV.
2. **No XCLSV / iGaming / operator / affiliate relevance** — subject and body do
   not mention XCLSV, an operator (DK/FD/BetMGM/Caesars/Fanatics/Rebet/Polymarket),
   MLR, iGaming, affiliate marketing, event activations, ambassador programs, or
   any active deal counterparty.
3. **Boilerplate pitch structure** — one of:
   - Cold sales pitch for a generic service (SEO, PR/press placement, LinkedIn
     lead gen, email copywriting, cold-outbound-as-a-service, "get you in the
     news," "grow your MRR," accounting/bookkeeping, coaching/community).
   - Unsolicited capital / lending / investment pitch to an unknown recipient.
   - Newsletter/promo/webinar invite from a vendor with no relationship.
   - Recruiter cold outreach for an unrelated role.
   - Subject line uses "Exclusive" as if it were the company name (common cold-
     outbound personalization mistake — XCLSV is not "Exclusive Media").
4. **No direct question requiring Zaire's judgment** — a rate ask on an active
   deal is not cold outbound; "just wanted to introduce myself" is.

If **any** of 1–4 fails, fall back to the default (1-Respond low confidence). When
in doubt, still Respond — but a clean cold outbound with no hook to XCLSV's
business belongs in Archive.

## Edge cases

- **Contracts & attachment-heavy threads:** 1-Respond with a "needs reading" tag in the
  digest. Never auto-draft substantive replies to legal documents.
- **First contact from a plausibly relevant partner:** 1-Respond, low-confidence
  flag. This is a genuine inbound lead (iGaming vendor, operator contact, agency
  cross-sell) — never auto-archived. Cold-outbound archive signals above apply
  only when the pitch is generic AND has no iGaming/XCLSV/operator hook.
- **Gmail API failure / rate limit:** retry with backoff; if a full sweep fails, post one
  alert line in Slack rather than failing silently.
- **Stale digest actions:** if Zaire acts on an item already resolved, reply
  "already handled at [time]" instead of double-drafting.

## Digest format

Posted to #inbox-gps as a top-level message. Capped at 10 items, oldest-first; overflow
noted as "+N more in 1-Respond". Numbered so Zaire can reference items by voice.
No preamble, no sign-off. Three sections:

### A. Needs You

Every 1-Respond thread, one line each:

```
3) Luis / Outlier — asking to confirm September slate scope — waiting 3d — [link]
```

Format: `n) Sender / Company — the ask in a few words — age — [link]`. Append
"(low confidence)" or "(needs reading)" tags where they apply.

### B. Ready Nudges

3-Waiting threads past threshold, each with its pre-written follow-up already drafted
(`nudge-rules.md`). Zaire approves or skips by number.

### C. Flags

- Unapproved drafts older than 24h.
- Threads on their 2nd unanswered nudge (decision prompt: call, drop, or re-route).
- Arya-assigned Asana tasks open >3 business days without progress.
- Fridays only: the 2-Review weekly rollup count.

## Voice-command handling (digest replies)

One batched voice memo replies to a digest; split the transcript per item, one verb per
item. Items not mentioned default to **Skip**.

| Verb | Behavior |
|---|---|
| "Tell / Reply to X…" | Draft a reply carrying the stated content. Default verb when intent is clearly a response. |
| "Push / Snooze [to Fri]" | Remove from digest; resurface on the stated date (default: 3 business days). Label unchanged. |
| "Skip" | Leave as-is; reappears next digest. |
| "Archive" | Archive the thread; drop from state. |
| "Delegate to Anna / Andrea…" | Draft a forward with a 2–3 line context summary and the stated instruction. Same approval gate. |
| "Nudge / Send the follow-up" | Approve the pre-drafted nudge for that Ready Nudges item. |

**Ambiguity rule:** if an instruction can't be confidently matched to exactly one item,
do not guess — reply in-thread ("Did you mean #2 (Lucas/MLR terms) or #5 (Rebet
banner)?") and wait. If two memos arrive before processing, the later instruction wins
per item.
