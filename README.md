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

## Repo layout

See the layout block in `CLAUDE.md`. Behavior lives in `agent/` (markdown, tuned by
editing text); plumbing lives in `src/` (built in stages 2–7). `data/` (corpus,
embeddings, state DB) is created at runtime and never committed.
