# ErrGrind product contract in the Harness fork

This is the fork-local product authority for the current mathematics MVP. The
[local migration inventory](../history/python-product-2026-09-27/inventory.md) preserves the older Python/React product's instructions, design, progress, and prompts. The
[original fork decision](../history/python-product-2026-09-27/design/decisions/2026-09-23-error-episode-and-agent-fork.md.txt) records its rationale; [migration disposition](migration.md) defines current ownership. The source in this repository shows what currently runs. DSH
infrastructure is described in `docs/architecture.md`, `docs/subsystems/`,
package READMEs, and `.agents/notes/`; those describe the runtime, not the
ErrGrind learning model.

## Purpose and evidence

An authentic Error anchors one investigation of the learner's thinking.
Grill gathers new, discriminating Evidence about the mechanism at the time of
that Error. The learner's later account of their earlier thinking is useful
but noisy. Preserve the difference between original user text and attachments,
later recollection, current understanding, model interpretation, host relay,
and post-intervention behavior. A model reading an image is not the learner's
verbatim text. Neither a single diagnosis nor a Drill result proves a durable
Pattern. Long-term Pattern inference needs independent, later Evidence and is
outside this slice.

The longer product direction is Error → Grill → Teach → Drill → Future Error:
future independent Errors can update or falsify a Pattern, and an Action aims
to reduce future Errors. State and Policy are useful only when they help decide
whether to gather more Evidence or intervene. This direction does not imply a
Pattern, cross-Error learner model, or adaptive Policy already exists here.

## Current episode workflow

The first user-sourced message opens a recoverable Error episode. The agent
drafts one complete, user-readable Error description and may ask factual
clarifications or diagnostic probes in the same continuous Grill. The draft
is revisioned and remains editable while Grill is active. `grill_conclude`
proposes a diagnosis tied to the current revision; it does not finish Grill.
Only the learner's confirmation of that proposed final description commits
the diagnosis and ends Grill. The Error card's confirm control is the single
confirmation path; a typed `/error-confirm` submits as ordinary chat. If they
do not confirm, Grill remains open; later clarification, probe, or revision
invalidates the proposal. Confirmation accepts the description, not the
model's causal claim.

The proposal can be `supported` when an actual user answer to a probe grounds
the preferred mechanism, or `undetermined` with explicit uncertainty. Grill
may use a reasoning question or a short variant to distinguish competing
hypotheses. Private predictions and variant answers stay in the Host ledger;
the public Web view shows only permitted fields. Grill investigates the
original Error-time mechanism, not the causal effects of later instruction.

Teach begins only after joint confirmation. It is an intervention and may
continue in the same conversation. An independent Drill runs in its own
Session, opened on demand from a completed Error's history entry. It stores a
private specification and reference answer. Judgment binds to a persisted
learner response. A correct verdict archives the Drill Session; a wrong
judgment atomically records an attempt and a lineage-bound derived Error,
which the Host materializes as a separate pending episode. Neither Teach nor
Drill responses become retrospective evidence about the original Error.

The DSH Session log is the durable fact source for this fork. Core projections
and validators own the episode state, evidence grounding, transitions, and
Drill lineage. The runtime owns model calls and context assembly; the browser
receives a public projection. A future MCP adapter must use the same domain
rules and preserve observable host relay origin instead of creating its
own Error workflow or authoritative store. The older Python Application and
SQLite schema are migration inputs, not fixed interfaces for this fork.

## Migration disposition

| Old source | Current fork treatment |
| --- | --- |
| `AGENTS.md`, `design/core-principles.md`, active Grill decisions | Domain principles and applicable working rules above; shared runtime guidance in `prompts/system.md`, tool-specific guidance in `prompts/tools.json`, executable rules in `packages/core/errgrind-episode/`. |
| `prompts/grilling.md` | Diagnostic judgment, probes, and stopping guidance moved to `grill_probe` and `grill_conclude` descriptions. Structured fields and validation remain in Core; old JSON-only output protocol is obsolete. The Error projection seeds Evidence from first direct or relayed text and attachment facts; an initial attachment Evidence item has an empty quote. |
| `prompts/teach.md` | Mechanism-aware, uncertainty-aware teaching guidance moved to `teach_step`; old three-field placeholders, fixed lecture sequence, and mandatory closing formula are obsolete. |
| `prompts/drill_spec.md` | Target mechanism, trigger, failure behavior, desired behavior, observable success signal, domain, task setting, goal, essential trigger, solution strategy, avoid list, difficulty, reasoning depth, and calculation load moved to the isolated `drill_prepare` DrillSpec. The generated question and reference answer are private draft results, never tool input. |
| `prompts/drill.md` | Novel, self-contained practice and private answer quality guidance moved to `drill_prepare`. The old `reference_answer` field is replaced by the isolated Draft JSON fields `question` and `referenceAnswer`; JSON output remains required. |
| `prompts/judge.md` | Equivalent-method and reasoning feedback guidance moved to `drill_judge`. The old rule that insufficient reasoning alone means a mathematically wrong answer is rejected; the current boolean verdict cannot separately record mechanism evidence. |
| `prompts/record_draft.md`, `prompts/ocr.md`, `prompts/ocr_record_input.md` | Three-field and separate OCR output protocols are obsolete. The product uses one revisable Error description and native image input with original-byte receipts; inferred image text is not user-verbatim Evidence. |
| `prompts/ocr_field.md` | Field-specific transcription is obsolete for Error intake. Image Drill answers now use `drill_answer_draft` for a reviewable draft; the learner replies `确认` or `修正：...` to complete the response before judgment. |
| Python `pending-grill → pending-teach → done` and Ctrl+C rules | Superseded for this fork by the active/proposed/completed episode, revision-bound confirmation, and Session recovery rules above. The old code keeps its own contract until replaced. |

`errgrind-fork/web.patch.yml` loads `prompts/system.md`; the episode plugin
loads `prompts/tools.json` as its actual model-visible tool descriptions and
parameter guidance. The `legacy/` symlinks are removed. Core still enforces
schema, origin, privacy, and state. Static prompt and tool schemas keep
the request prefix stable for provider cache reuse; actual hit rate needs
real usage telemetry.

## Current implementation rules

- The first direct or relayed text and attachment facts seed structured
  Error-time Evidence. Initial attachment Evidence uses an empty quote, since
  the durable image is the source. The `latest-probe-answer` alias resolves
  to its durable source before evidence grounding validation. Replies
  recorded as user messages while an `error_clarify` question is pending are
  indexed as structured Evidence with their source text and images; other
  pre-Grill chat is not eligible Evidence. Once Teach starts, later answers
  are excluded from Error-time Evidence and the original draft is locked.
- Original image bytes require a durable `saveFile` receipt; upload fails if
  that save fails, and an image in the first Error message cannot open an
  episode without a receipt. Normalized image refs carry the exact original
  receipt, and batch validation precedes writes.
- Image Drill answers use the `drill_answer_draft` event/tool and a
  reviewable draft; the learner must reply `确认` or `修正：...` to complete
  the response before judgment.
- Drill generation is isolated from the original Error conversation. A
  spec-only `drill_prepare` call persists the exact 15-field specification
  before model I/O, retries that saved spec after failure, and logs provider,
  model, prompt, and usage internally. The public result contains only the
  generated question. The Judge receives a durable private context message
  containing the validated answer key; browser projections and search omit it.
  Distinctive source text in new-problem fields is rejected before the Draft
  request; this lexical check cannot prove semantic novelty.
- The `errgrindEpisode` (stateVersion 9) and `errgrindDrill` (stateVersion 3)
  projections are host-only. A stateVersion change refolds the projection
  from the Session log; it is separate from the Session format version. The
  Session Controller public view filters event fields, so private diagnosis
  data and the Drill answer key stay in Host context. Drill draft failures
  and cancellations retain a recoverable pending specification while
  exposing only a retry status card.
- The Web UI presents the episode's public content inside the conversation:
  the Error card keeps its action shell (title, status, confirmation
  control), prompts awaiting learner input keep a light frame, and
  model-authored content renders as ordinary assistant Markdown; free
  assistant text stays hidden, and `/error-status` is disabled in Web. The
  eight model tools are `error_draft`, `error_clarify`, `grill_probe`,
  `grill_conclude`, `teach_step`, `drill_prepare`, `drill_judge`, and
  `drill_answer_draft`.
- An Error history sidebar lists the fork's Sessions from a narrow public
  episode view. Sessions without cached classification remain openable. The
  old SQLite records entered the fork store through a one-off external
  importer; the product ships no repeatable import path. An explicit Drill
  action opens a dedicated Drill Session for one completed Error, where Core
  checks the current diagnosis before generating practice.
  The old generic option let the model choose one eligible Error, rather than
  synthesizing one question across Errors. This fork does not implement a
  learner-wide or cross-Error model.

## Working rules carried from the older project

- Define ErrGrind's Error, Evidence, diagnosis, and intervention semantics in
  its own contract. Reuse DSH for generic chat, attachments, sessions, model
  calls, and tools without adopting an unrelated product ontology. Before
  building a nontrivial generic capability, inspect what DSH and established
  implementations already provide; compare integration, security, upkeep,
  and exit costs.
- Preserve origin and one workflow authority across Web and future MCP.
  Do not implement state transitions, diagnostic validation, or private-data
  filtering independently in each adapter. Keep public responses free of the
  private Grill ledger, predictions, variant keys, and pre-judgment Drill
  answers. Prefer structured state over a model re-deriving it from prose.
- Design user surfaces around the Error investigation, not around commands,
  tables, event names, or plugin boundaries. Validate important flows with a
  realistic mathematics case, including recovery and narrow-screen use.
  Use real usage and token telemetry before tuning prompts, cache behavior,
  compaction, or model selection. Give high-switching-cost changes to domain,
  persistence, and runtime more scrutiny than copy or styling changes.
- Keep user-reviewable behavioral prompts under `errgrind-fork/prompts/`.
  Tool descriptions and parameter guidance are loaded from `tools.json`;
  tool names and input schemas stay beside the executable contracts. Review
  both as model-visible surfaces when changing behavior. Give user-facing
  guidance and errors in clear Chinese. Use
  focused Core and adapter checks for workflow changes, then a real-model
  acceptance pass for diagnostic quality.

The older Python `ErrGrindApplication` layering, SQLite tables, CLI key
bindings, Ctrl+C/EOF handling, Python exception syntax, exact test command,
and old `design/` index policy are implementation instructions for the old
repository. DSH's own architecture, package, documentation, and test rules
govern their corresponding fork paths.

## Status and acceptance

This contract states rules, not progress. Implementation progress,
completed real-model acceptance, and unverified items are recorded only in
the [product TODO](../todo.md); checks that need a human learner are in the
[human acceptance plan](human-acceptance.md).
