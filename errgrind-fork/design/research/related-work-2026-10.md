# Related work survey (October 2026)

## Scope and verdict

Surveyed whether any public GitHub project already implements the ErrGrind loop: real-error anchor → evidence → Grill (discriminating evidence collection across competing hypotheses) → Teach → Drill → Judge (correct ≠ fixed) → cross-error falsifiable Patterns.

**Verdict: no complete implementation.** 30 query families produced 852 deduplicated candidates; every stage of the loop exists somewhere, but nobody assembles all of it. The differentiation holds on four points jointly: real errors as the anchor, Grill as hypothesis-discriminating evidence collection rather than pedagogical Socratic replay, error lineage (wrong Drill answers spawn new Errors), and cross-error falsifiable Patterns.

Raw data: `candidates.tsv` (deduplicated candidates sorted by stars), `results.jsonl` (one row per hit with the matching query), `queries.txt` (reproducible query list). This is a regenerated scan; the first round's raw data was lost with `/tmp` — key confirmed hits are tagged `manual-known-hit`.

## Closest match: Diagnos (code- and live-verified)

[neterfk-coder/Diagnos-proyect.edu](https://github.com/neterfk-coder/Diagnos-proyect.edu) (hackathon project, MIT; live demo at diagnos-hazel.vercel.app with guest mode). Single-variable linear equations: photo/typed work → locate the first broken step → classify into a fixed 12-item misconception catalogue → questions-only Socratic dialogue → 3 generated exercises → dual-axis verdict.

Verified in code (constraints are real, not README claims):

- `lib/misconceptions.js`: closed catalogue of 12 algebraic misconceptions (SIG-01 etc.), each citing published research (Matz 1982, Küchemann 1981, …).
- `app/api/diagnose/route.js`: first-broken-step vs dragged-down steps marked separately; `explicacion` carries BAD/GOOD pairs forbidding rule disclosure; strict `json_schema`.
- `app/api/socratic/route.js`: questions only, one short question per turn, minimal counterexample hint after two stuck turns (still no solution), `[DESCUBIERTO]` sentinel on self-discovery.
- `app/api/exercises/route.js`: fixed 3 exercises basico/intermedio/desafio; desafio must contain an edge case where the misconception yields an absurd result.
- `app/api/verificar/route.js`: `correcto` (final answer right) and `reincide` (the specific misconception recurred) judged independently.

Verified live (novel sign-transposition error `5x-7=23 → 5x=23-7`):

- Diagnosis marked step 2 broken, classified SIG-01, described the false belief without the rule.
- Two direct answer requests were refused with re-angled questions; a feigned self-discovery triggered `[DESCUBIERTO]` and unlocked practice.
- The three-tier generation worked (CHALLENGE `2x+5=2x-7` is the self-refuting edge case).
- Re-committing the misconception produced `reincide` + a follow-up question with no answer; a correct solution produced Overcome.
- **Confirmed defect**: submitting work that was entirely wrong but did not exhibit the misconception was flagged "steps do not follow, incorrect solution" yet counted toward "2/3 overcome". `components/PracticaDirigida.jsx:19` computes `superado = !veredicto.reincide` — progress uses only the reincide axis; the correcto axis is computed but unused. "Correct ≠ fixed" is enforced, "wrong ≠ unfixed" is not.

Structural differences from ErrGrind: diagnosis is single-pass closed-catalogue classification (the dialogue cannot revise it); the Socratic dialogue is pedagogical replay toward a known answer, not competing-hypothesis evidence collection; no error lineage; no cross-error Patterns; persistence aggregates by classroom JWT for a teacher heatmap — the data model has no per-learner longitudinal identity, so self-study has no substrate. Mechanistically, Grill presupposes strong reflective intent in the learner, which teacher coercion cannot supply; teacher-facing is not a narrower market, it is a non-starter.

## Other notable hits

| Project | Overlaps | Missing |
|---|---|---|
| [Juroz4/kouhu_bot](https://github.com/Juroz4/kouhu_bot) | QQ bot implementing exactly "grill-my-reasoning": `/cf` `/lg` random problems → `/提交` approach → DeepSeek judges + hints | One-shot judging; no diagnosis or tracking |
| [hexa3/lucid](https://github.com/hexa3/lucid) | Feynman explanation → embedding recall into a misconception catalogue + LLM verification requiring quoted student words as evidence → mastery + SM-2 | Anchor is voluntary explanation, not real errors; 4 hand-written topics; hackathon mock |
| [ArnaudGuiovanna/tutor-mcp](https://github.com/ArnaudGuiovanna/tutor-mcp) | MCP server turning any LLM into an ITS: BKT mastery + FSRS + misconception memory + transfer probes + auditable decisions | General learning engine, not an error debugger |
| [parvpatodia/Feynman-Loop](https://github.com/parvpatodia/Feynman-Loop) | Judge must quote the user's verbatim words, verified in code (provenance-style evidence) | No error anchor, no diagnosis |
| [digitalboy/RCAE_graph_data](https://github.com/digitalboy/RCAE_graph_data) | Math root-cause analysis + exercise system, knowledge-graph weak-root localization | Main system closed; only the dataset is public |
| Chinese 错题本 family ([ai-wrong-notebook](https://github.com/tjunsh/ai-wrong-notebook), [E-Bu](https://github.com/aymwoo/E-Bu), [edustar](https://github.com/zqdwinding-create/edustar), [zhixue-wrongbook](https://github.com/QiuMo246/zhixue-wrongbook), student-kpscan, gongkao-ai, ~a dozen more) | "Photo → AI cause-tagging → variant drills → spaced review" is an established pattern | Cause = knowledge-point classification; no hypothesis interrogation; no correct-≠-fixed |
| grill-me skill ecosystem ([mattpocock/skills](https://github.com/mattpocock/skills) + zhudan930612/grill-me and a dozen forks) | "Grilling" as a verb has spread | All stateless prompt skills |
| Academic KT/BKT stack (pyBKT, OATutor, DeepKnowledgeTracing, pykt-toolkit) | Mature mastery-probability tracking | Item-bank driven; no error narrative; no reflective interrogation |

## Market-structure note

Projects with real diagnostic depth are teacher-facing (classroom scale amortizes cost and gives heatmaps commercial value); personal tools are shallow 错题本 classifiers. "An error debugger for self-learners" is an unoccupied cell — ErrGrind being built for its own author lands exactly in the gap.

## Takeaways

- Diagnos's CHALLENGE design (an exercise where the misconception produces `5 = -7`-style absurdity) independently validates the discriminating-probe idea; cite it in related-work.
- Its `reincide` axis (does *this* misconception recur, independent of answer correctness) is a useful implementation reference — and its one-axis-only defect argues for keeping both `math_status` and `mechanism_evidence` in progress.
- If a standalone "grill-my-reasoning" entry point is ever built, kouhu_bot confirms the QQ-group scenario exists (NoneBot2 + NapCatQQ stack is directly reusable).
