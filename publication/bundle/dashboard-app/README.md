# WHO AFRO Humanitarian Dashboard (Public Data MVP)

## What This MVP Includes

- FCV country scope dashboard for 13 countries.
- Public online data ingestion from:
  - World Bank API (nutrition indicators)
  - GDACS RSS (hazard events)
  - ReliefWeb RSS (recent situation reports)
  - ICPAC weekly/monthly/seasonal forecast pages (bulletin stream)
  - Dedicated cyclone websites: Meteo-France La Reunion, Cyclocane, and WMO Severe Weather Information Centre
- WHO-styled interface with logo and daily date stamp.
- Sidebar page navigation: Overview, Country Explorer, Forecast Studio, Hazard Monitor, Daily Briefing.
- Square, banded interactive risk map with hover details.
- Forecast charts and projection table for selected countries.
- Auto-display mode for screen rotation during daily briefings.
- Restricted Q&A panel constrained to loaded dashboard data.

## Run Locally

1. Open a terminal in this folder.
1. Install dependencies:

```bash
npm install
```

1. Start the app:

```bash
npm start
```

1. Recommended when port 3000 is stuck from a previous run:

```bash
npm run start:clean
```

1. Open:

```text
http://localhost:3000
```

## API Endpoint

- `GET /api/dashboard-data`
  - Returns aggregated country metrics, hazard items, ICPAC forecast items, report items, and top alerts.

## Source Access Modes (403 Mitigation)

Set these optional environment variables in `dashboard-app/.env` when a provider blocks automated requests with `403`.

- `UNHCR_FETCH_MODE=reliefweb-first` (default)
  - Prioritizes ReliefWeb-based UNHCR ingestion so displacement signals still load when UNHCR RSS is blocked.
  - Other options: `auto`, `unhcr-first`.
- `ACLED_AUTH_MODE=on-demand` (default)
  - Tries public ACLED Conflict Index CSV first, then attempts credential login only if access is denied (`401/403`).
  - Other options: `off`, `always`.
- `ACLED_CONFLICT_INDEX_CSV_URLS` (optional, comma-separated)
  - Adds extra candidate ACLED CSV endpoints to try before failing.
- `DASHBOARD_CACHE_TTL_SECONDS=120` (default)
  - Controls `/api/dashboard-data` response cache TTL. Lower values increase freshness but can slow repeat loads.
- `WHO_DON_MODE=auto` (default)
  - `auto`: try WHO DON source (RSS, then WHO DON page fallback).
  - `off`: disable WHO DON pulls when endpoint stability is poor; the dashboard continues with ReliefWeb-derived outbreak signals.
- `RELIEFWEB_APPNAME` (optional; requires ReliefWeb approval)
  - Enables direct ReliefWeb Reports API pulls for stronger Africa flood coverage.
  - Approved appname for this dashboard: `whoafro-dashboard-a9z2`.
  - Set `RELIEFWEB_APPNAME=whoafro-dashboard-a9z2` in the deployment environment once the approval has propagated.
  - Runtime verification: `/api/dashboard-data` exposes `reliefweb_api_status` so operators can confirm whether direct Reports API enrichment is `active`, `configured_no_matches`, `disabled`, or `error`.

Notes:

- ACLED now caches the most recent successful CSV in `dashboard-app/data/acled-conflict-index-cache.csv` and can reuse it when upstream is temporarily blocked.
- Manual `Refresh Data` in the UI sends `force_refresh=1` to bypass response cache for a live pull.
- These settings are designed to preserve data availability, not suppress data sources.

## Daily Display Tips

1. Use sidebar buttons to switch pages interactively.
1. Click `Start Auto Display` in the sidebar for rotating screens in meeting mode.
1. Use `Country Focus` selector to update trend and forecast pages.
1. Click country rows in the comparison table to jump directly into country detail views.

## Print QA Checklist

Run this checklist before sharing a bulletin PDF:

1. Wait for data load to complete (`Refresh Data` button is enabled and no `Loading...` label remains).
1. Click `Export Bulletin (Print)` and confirm inline status feedback appears in the sidebar.
1. In print preview, confirm page 1 contains visible bulletin header and body text (not blank).
1. Confirm there are no fully blank pages between populated report pages.
1. If export is skipped, wait for load completion and retry when the status message indicates readiness.

## Notes On Projections

- Projection values shown in the trend panel are transparent linear trend estimates from available historical public values.
- They are for exploratory planning support and are not official forecasts.

## Current Scope Boundaries

- No private WHO or country-office restricted data is used in this MVP.
- Restricted-source connectors can be added later after data access approval.

## Continuity Documents

- `AGENT_HANDOFF_GUIDE.md`: Required professional standards, handoff protocol, and quality gates.
- `WORKLOG.md`: Step-by-step progress log with next-step continuity notes.
