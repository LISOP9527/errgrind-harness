# Evaluation and acceptance findings (2026-10-01)

English | [中文](eval-findings.zh.md)

Results for todo items 36–40: one focused Spec/Draft guidance evaluation, the Judge verdict-split analysis (no schema change — that item explicitly forbids auto-approval), old-Drill UX archaeology, Settings acceptance, and usage accounting against real session logs.

## Spec and Draft prompt guidance (todo 36) — PASS

Method: replay the exact model-facing context over `hongyun-astra` — `prompts/system.md` + the verbatim `drill_prepare` tool contract from `prompts/tools.json` + a compact concluded-episode summary — then run the isolated draft call byte-identically to `drill.ts` (system = `prompts/drill-draft.md`, user = `JSON.stringify(spec)`). Three episodes: denominator-constant-term miss (ellipse), square-expansion cross-term, inequality sign-flip.

- **target behavior essential**: all three checks hit the missing step (multiply, expand, flip) as a necessary node.
- **successSignal observable**: every signal is a writable, checkable trace a student can produce.
- **question/answer agreement**: verified by hand (x=18; 60 ㎡; 5<t<8).
- **sufficient conditions**: explicit acceptance conditions and domain windows in every spec.
- **surface change**: billing, rectangle-area, and water-tank surfaces; none reuse the original surface.
- **reasoning/load split**: depth 2, cognitive load 1–2, small integers throughout.
- No mechanism, success-signal, or diagnosis vocabulary leaked into question text.

Caveats: single route (astra only), one sample per case, episode inputs were constructed summaries rather than real Grill transcripts, and `rejectSourceLeak` was not stress-tested with adversarial specs.

## Judge verdict split (todo 37) — risk documented, no schema change

Current contract: `drill_judge` returns `{isCorrect, feedback}`; the tool prompt tells the model that insufficient mechanism evidence is not a math failure and must not alone derive an Error. The Python product judged math correctness and success-signal evidence in the same boolean ("无法观察到信号判为错误").

Risk: the boolean has no home for "math right, mechanism evidence not observed". The model must round it to true (silently dropping the missing-evidence flag) or false (deriving an Error — which the policy forbids on evidence-insufficiency grounds). Prompt guidance mitigates but cannot encode the split deterministically.

Options, when Judge is next touched (schema changes require explicit approval — none made):

- **(a) Keep the boolean** — status quo; prompt wording carries the policy.
- **(b) Split fields** — `mathCorrectness` + `mechanismObserved`; derived Errors only when math is wrong AND evidence is in.
- **(c) Tri-state** — `correct | wrong | evidenceInsufficient`; more expressive, more UI surface.

Recommendation: **(b)**. It preserves the atomic derive semantics while making the evidence-insufficient case a first-class, loggable outcome instead of a rounding decision.

## Old-Drill UX archaeology (todo 38) — keep list

From `errgrind/cli/commands.py` and `errgrind/application/drill.py`:

- **`/drills` history surface** (question + target Pattern 5 fields + "不代表已确认的长期 Pattern" disclaimer + prompt/schema SHA-256): the fork has no drill-history surface. Keep on the list — the episode card's history section is the natural home.
- **Verdict-only popup**: old drill showed only 正确/错误 in the modal; feedback persisted to `drill_attempts` but wasn't displayed. The fork renders verdict + feedback durably in the transcript card — deliberate divergence, kept (feedback is where the evidence-insufficiency nuance lives).
- **Atomic attempt record**: old `record_drill_attempt` wrote the attempt and derived Error in one transaction; the fork's `errgrind/drill-judged` event carries `derivedError` in the same event. Equivalent atomicity preserved.
- **Judge provenance**: old stored provider + model + prompt-sha256 + schema-sha256 on the attempt. Fork stores provider + model on the event; prompts and schemas are git-tracked in `prompts/tools.json`, so version provenance resolves through the repo. Acceptable — no per-attempt sha needed while prompts stay version-controlled.

## Settings acceptance (todo 39) — PASS, one fix landed

- **Credential no-echo**: the credentials controller projects only `{configured, source, writable}`; `set` is write-only (`packages/api/settings-controller/src/credentials.ts`, `projectCredentialInfo`).
- **No cross-use**: per-route `apiKeyEnv`; the astra/opus keys are separate refs — the live AUTH-failure run proved independence.
- **Saved state**: `describe` + ModelsSection show configured status (verified in-browser during de-brand batch 1).
- **Stale-draft fencing**: `ProviderEditor` refuses writes when the draft was opened at an older revision (`expectedRevision` in operations).
- **Directory fallback**: `defaultWorkspaceDirectory` resolves `Documents/deepseek-harness/ErrGrind`; a failed or disabled Documents lookup throws → `defaultWorkspaceFailed` toast → 'Choose workspace' picker. That recovery path was broken by the G6 `directory-picker` removal — `remote.directoryPicker` resolves the plugin by name, so the picker opened an empty menu. The removal row has been reverted and the audit corrected.

## Usage accounting (todo 40) — PASS

Verified in detail on the `session-8e1ffc5b…` acceptance log — the only one of the three runs with a complete successful pass; items below that rest on the event schema rather than an observed log are marked as such.

- **Phase distinguishable**: per-step `usage` on every `assistant/message` (input/output/total/cacheRead), with tool calls on steps identifying Record/Grill/Teach/Drill phase; the isolated draft call reports usage separately on `errgrind/drill-draft-finished`.
- **Failure distinguishable**: `drill-draft-finished.status` (`success|failed|aborted`) and `turn/end` reason kinds.
- **Repair/retry** (inferred from the retry/step event schema — no retry observed in the verified log): retries are expected to land as additional steps carrying their own usage; there is no explicit repair marker — repetition of a tool call would be the signal.
- **Cache**: `cacheReadTokens` recorded per call when the relay reports it. Observed behavior: hongyun stops reporting cache reads mid-session (turns 7–9 ran ~25k-token contexts with no `cacheReadTokens`) — a data point for the human-test 缓存用量 item.
- **Missing usage**: `usage` is absent when the provider omits it (schema optional by design).
- **Privacy**: zero credential material in the logs — no key values, no `Bearer`/`apiKey` strings; `request/header` records config (provider, model, effort, maxTokens) and tool names only.
