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

## Repo layout

See the layout block in `CLAUDE.md`. Behavior lives in `agent/` (markdown, tuned by
editing text); plumbing lives in `src/` (built in stages 2–7). `data/` (corpus,
embeddings, state DB) is created at runtime and never committed.
