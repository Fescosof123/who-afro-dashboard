# Agent Handoff Guide For This Dashboard

## Purpose

This guide ensures continuity when work transfers between agents and enforces a professional standard of decision-making.

## Operating Principle

- The agent must use independent professional judgment.
- The agent must not agree automatically with user suggestions.
- The agent should challenge ideas that reduce data integrity, usability, or decision quality.
- Final recommendations should be evidence-based and explicitly justified.

## Required Working Method

At every meaningful update, the active agent must record three things:

1. Step completed
2. Current progress status
3. Next step

If work stops mid-task, this record must still be updated before stopping.

## Progress Log Template

Use this format in `WORKLOG.md`:

```text
Date/Time:
Step Completed:
What Changed:
Validation Performed:
Current Status:
Next Step:
Risks/Blockers:
Decision Notes:
```

## Professional Review Rules

Before accepting a design or technical direction, evaluate:

1. Decision utility for leadership
2. Data transparency and source traceability
3. Forecast interpretation safety
4. Interaction clarity on desktop and mobile
5. Operational suitability for daily display

If any area is weak, improve it before sign-off.

## Dashboard Quality Bar (Pre-Presentation)

The dashboard is presentation-ready only if all are true:

1. Navigation is clear and page transitions are stable.
2. Visual hierarchy highlights top risk, hazards, and forecasts first.
3. Map, tables, and charts are interactive with meaningful hover details.
4. Forecast sections show method and confidence framing.
5. Auto-display mode works for meeting screens.
6. Data source scope and caveats are visible.
7. No blocking runtime or lint errors remain.

## Current Architecture Snapshot

- App path: `dashboard-app/`
- Backend: Express API in `server.js`
- Frontend: `public/index.html`, `public/styles.css`, `public/app.js`
- Public sources:
  - World Bank API
  - GDACS RSS
  - ReliefWeb RSS
  - ACAPS public homepage cards
  - IPC via HDX
  - ICPAC forecast pages
  - ACLED Conflict Index (public CSV scrape)
  - FEWS NET page/data-asset scrape
  - Dedicated cyclone monitoring pages (Meteo-France La Reunion, Cyclocane, WMO SWIC)

## Current Design Decisions

- WHO-themed visual language with logo and date.
- Sidebar page navigation.
- Square banded risk map for country comparison.
- Forecast page in source-only mode (IPC, ICPAC, and source-derived drought/cyclone summaries; no internal numeric trend forecast output).
- Daily briefing page and restricted Q&A.
- Auto-display mode with interval controls and pause on manual interaction.

## Latest Handoff Pointer

- Read the latest entry at the top of `WORKLOG.md` before coding.
- Current latest state: ACLED is integrated as structural conflict context, FEWS is integrated as reference and downloadable-asset discovery, ACAPS is integrated as public context cards, UNHCR direct RSS is blocked in runtime so fallback now prefers ReliefWeb's UNHCR organization page before generic ReliefWeb RSS metadata filtering, and IOM DTM is integrated as a supplemental displacement metadata/link source.
- Timestamp display was standardized to local datetime across operational refresh/event contexts, with ISO tooltips for audit traceability.
- ReliefWeb Reports API appname approval was granted for `whoafro-dashboard-a9z2`; use it in deployment configuration after ReliefWeb propagation completes.
- Known follow-up:
  - Decide whether ACAPS should remain summary-only or gain its own dedicated context panel.
  - Decide whether to add a dedicated FEWS panel for reference discovery details instead of summary-only embedding.
  - Optionally remove or archive temporary diagnostics scripts not needed for operations.

## Regression Guardrails

- Run `npm test` after changing API semantics, source contracts, or dashboard source-status fields.
- The smoke test currently protects: `fews_references` presence; absence of `fews_signals`; `acled_context_entries` presence; `acaps_updates` and `acaps_source_status` presence; ACAPS telemetry fields (`pages_cap`, `pages_scanned`, `pages_with_cards`, `pages_with_new_items`, `pagination_stopped_reason`); `iom_dtm_source_status` presence; `iom_dtm_reports` presence; exclusion of ACLED from `candidate_items_current` conflict counts; UNHCR candidate count > 0 via active fallback chain; UNHCR matched-total integrity (RSS + ReliefWeb + Population); numeric IOM matched-signal field; `candidate_items_structural` and `candidate_items_reporting_30d` presence (required by Decision Protocol trigger matrix).

## Semantic Guardrails

- Do not present ACLED Conflict Index rows as fresh incident reports or current-refresh candidate/matched reporting items.
- Do not present FEWS content as extracted country forecast values unless a real machine-readable country classification feed is implemented.
- Keep UNHCR fallback attribution restricted to publisher/category identity matches, not broad body-text mention matching.
- Preserve explicit wording in UI and API notes when a source is contextual, derived, or fallback-based.
- For conflict/displacement source health, preserve the candidate split semantics:
  - `candidate_items_current`: all source candidates considered in the current refresh.
  - `candidate_items_reporting_30d`: near-term reporting candidates only.
  - `candidate_items_structural`: structural burden context candidates (for example UNHCR annual population estimates).
- Preserve confidence badge semantics on source cards:
  - `Fresh`: matched items with reporting candidates present.
  - `Fallback-only`: matched items present but only through fallback channels (no direct source match).
  - `Structural-only`: structural context candidates present with no reporting candidates.
  - `Delayed`: candidates exist but none currently match signal rules.
- For ACAPS archive crawl transparency, preserve telemetry fields in `acaps_source_status`:
  - `pages_scanned`
  - `pages_with_cards`
  - `pages_with_new_items`
  - `pages_cap`
  - `pagination_stopped_reason`
- ACAPS archive traversal now supports mode-based configuration via `ACAPS_CRAWL_MODE`:
  - `deep` (default): uses `ACAPS_MAX_ARCHIVE_PAGES_DEEP` (default `10`).
  - `fast`: uses `ACAPS_MAX_ARCHIVE_PAGES_FAST` (default `6`).
  The cap is regularly hit in normal operations; `pagination_warning` fires when streak >= 3. This is expected behavior, not a bug.

## How To Continue Safely

1. Read `WORKLOG.md` first.
2. Confirm server health at `/api/health`.
3. Validate dashboard data at `/api/dashboard-data`.
4. Review browser rendering across all sidebar pages.
5. Make only incremental changes and revalidate after each change set.

## Non-Negotiable Stand

If a requested change would make the dashboard less truthful, less usable, or less decision-relevant, the agent must recommend a better alternative and explain why.
