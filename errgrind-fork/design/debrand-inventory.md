# DSH branding inventory

2026-10-01 real-UI audit, screen by screen (desktop + ~320px mobile). Screenshots live on the VM at `~/errgrind-evidence/debrand/` (01–14, not committed); full sweep recording `~/screencasts/rec-4e264b19-…`. Inventory only — nothing changed. Each finding names its removal path.

Verdict labels: **[config]** = locale dictionary or `web.patch.yml` field; **[disable-plugin]** = disable a plugin or command registration source; **[UI change]** = component code edit; **[architectural]** = requires renaming monorepo packages.

Already done, not repeated: title/manifest = ErrGrind (`errgrind-manifest.webmanifest`); `brand.localBuild` overridden to ErrGrind by `ui-errgrind-episode`; `welcomeNotice`/`credentialOnboarding` off (the old "Internal Testing Notice" carried DeepSeek Harness copy); model picker shows only the two Hongyun routes (`hideModelsWithoutCredential`).

## Severe: brand or internals leak

| # | Surface | Verbatim | Code location | Path |
|---|---------|----------|---------------|------|
| 1 | Settings → Models provider list | "openai-codex", "DeepSeek" rows (red dot, no credential) | `packages/client/ui-settings-models/src/client/ModelsSection.tsx` + `ModelRow.tsx`; rows come from `llm-pi-ai` (openai-codex) and `llm-deepseek` route declarations | [UI change] or [config]: hide credential-less provider rows behind a product flag, or drop the declarations from the patch |
| 2 | Settings → Models bottom | "Codex sign-in … Sign in with ChatGPT" OAuth block | **`packages/client/ui-errgrind-episode/src/client/CodexAuthSettings.tsx`** (our own package renders it, registered at index.ts:534) | [UI change]: remove the block from the ErrGrind product |
| 3 | Tokenless 401 page | `dsh web authentication required; reopen the URL printed by dsh web.` | `packages/client/connection/src/browser-auth.ts:309` | [UI change]: product-name the host response |
| 4 | Failed turn card | Renders `INVALID_CONFIG`/`INVALID_REQUEST`/`PI_AI_ERROR` badges + provider/model/compat names + HTTP body | turn failure display in `ui-chat`/`ui-conversation` (`TurnProcessNodeView.tsx` area); text comes from step/end reason | [UI change]: map to friendly copy, details stay in logs |

## Medium: coding-agent mental model

| # | Surface | Verbatim | Code location | Path |
|---|---------|----------|---------------|------|
| 5 | "+" / "/" command menu | **Permission** (sandbox+approval exposed) | command registered at `packages/interaction/permission-presets/src/index.ts:248`; `ui-permission` is already disabled but the command remains | [disable-plugin]: disable `permission`/`permission-presets`, or filter command registration |
| 6 | Same menu | **Compact** | `packages/compaction/command-compact/src/index.ts:101` (compaction group inside preset-standard) | [disable-plugin]: drop only `command-compact`, keep `compaction-basic` auto-compaction |
| 7 | Command menu + session header "..." | **Export** / "Download session log" | `packages/session-query/session-log-export/src/index.ts:79` | [disable-plugin]: disable `session-log-export` |
| 8 | Composer | Picking a command inserts bare `/permission <preset>`, `/feedback <text>`, `/error-confirm` templates | command → composer template injection (commands UI layer); args never reach execution — known gap | [UI change]: execute directly or prompt for args |
| 9 | Session header breadcrumb + sidebar | "Default workspace" as session title | `session-controller/client/sessions/service.ts:119` `workspaceTitleOf(cwd)` fallback when no title projection | [UI change]: ErrGrind title fallback should be the Error description or neutral copy |
| 10 | Sidebar Error history bottom | "These older sessions have not been classified yet…" + "Default workspace" entries | `ui-errgrind-episode` locales `history.unclassified` | [UI change]: reword or hide (our own package) |
| 11 | Under each turn | "Worked" / "Took 39s" / "Failed" chips | `ui-chat/src/client/locale.ts` `message.turnProcess.*` + `TurnProcessNodeView.tsx` | [config] copy; [UI change] hide chips entirely |
| 12 | Settings → General | "Send behavior while busy — while the agent is running" | `ui-settings-general` | [config/UI change]: ErrGrind has no agent-busy concept — hide the row |
| 13 | Settings → General | Developer tools, Open configuration file, Performance & usage, "turns and steps", footer "Current version: 0.1.7-alpha.2" (shell version posing as product version) | `ui-settings-general` + `ui-settings/src/client/developer-tools.ts` | [disable-plugin/UI change]: hide per-item; version from a product build var |
| 14 | Top-right "Open right sidebar" | Generic dock workbench: "Start" tab, Split, Fullscreen | `packages/client/ui-sidebar-right` | [disable-plugin]: ErrGrind needs no multi-pane dock |
| 15 | Composer model pill → Effort | 8-rung ladder Default/Off/…/Max | route `reasoningEfforts` (astra offers all) | [config]: narrow rungs per product |

## Light / wording unification

| # | Surface | Verbatim | Code location |
|---|---------|----------|---------------|
| 16 | Session right rail | `aria-label="Jump to turn N"` | `ui-chat` locale `chat.turnNavigation.jump` |
| 17 | "+" menu | "for this conversation" / "this session" | `ui-model-selection` and `ln` command descriptions |
| 18 | Error card footer | "…in the conversation" | `ui-errgrind-episode` locales (ours) |
| 19 | Hidden DOM | `data-hero-workspace-picker`, workspaces section, `crumbSubagent` styles still emitted | `ui-workspace`; CSS-suppressed today — long-term remove the plugin |
| 20 | view-source | bundle URLs `plugins/@deepseek-ai/dsh-*`, `__DSH_BOOT_READY__`, `--dsh-*` CSS vars | build artifact naming | [architectural] long-term |

## Verified clean surfaces

- First-run hero: "EG" + "Start with a math mistake", no DSH; composer has no placeholder hint
- Sidebar bottom shows only the Settings gear; no version/build label leaks (version lives inside Settings, see #13)
- Model picker lists only the Astra/Opus relay routes
- "/" and "+" menus identical; no terminal/files/workspace/jobs/subagent command leaks
- No in-app right-click menu, no shortcut-help page
- Mobile ~320px: rail collapses correctly; same leftovers as desktop (Default workspace title, menus, right pane goes fullscreen)

## Suggested minimal fix set (for scheduling)

1. Settings → Models tab: drop openai-codex/DeepSeek provider rows, the Codex sign-in block, and "+ Add model provider" — one change removes the most blatant leftovers
2. Command surface: drop Compact/Permission/Export (reassess Feedback/Model); no bare `/cmd` template insertion
3. Failed turn card: friendly copy mapping — hide provider/model/compat/HTTP body
4. "Default workspace": session-title fallback + unclassified-section wording
5. Disable `ui-sidebar-right` + hide agent-specific Settings rows (Developer tools, Send behavior while busy, Performance & usage, Open configuration file)
6. 401 copy without "dsh web"
