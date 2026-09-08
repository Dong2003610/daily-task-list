# Isolated regression tests

Run from the project directory:

```powershell
npm test
npx playwright test
npx tsc --noEmit
```

Vitest discovers only `tests/**/*.test.ts`; Playwright discovers only `tests/e2e/**/*.spec.ts`. Neither changes the application or package scripts.

Playwright launches installed Edge headlessly using `EDGE_EXECUTABLE`, falling back to `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. It starts its own local server with `npm run dev -- --port 4173 --strictPort`; port 4173 must be free. It deliberately refuses to reuse an existing server so test-specific backend configuration is applied.

Every test has a fresh browser context, synthetic JWT/session and in-memory task/metadata store. The backend fixture intercepts **all** requests to `backend.appmiaoda.com`; unknown endpoints fail the test without reaching the network. Only the local Vite origin is allowed through. Other external HTTP/WebSocket requests, including fonts, are blocked, and service workers are disabled. No real account, credentials, or task database is used.

The mock preserves task primary keys and `ignoreDuplicates` semantics, merges user metadata, supports task filters (including `gt` keyset cursors and `lte`), order/pagination and scoped writes, and allows deliberate failures or lost responses after successful writes. Two pages within one test share the same mock store, exercising stale carry replay. A one-shot insertion hook models concurrent cancellation before metadata reconciliation. It is not a substitute for testing production authentication, RLS, or database constraints.

Domain tests cover the Shanghai calendar (including leap-century rules and the noon date anchor), carry ancestry/independent homonyms, cancellation metadata, deterministic identity, recurrence calendars and start dates, reminder catch-up, and CSV escaping/formula safety. API unit tests mock both authentication and direct fetch to check account binding, captured authorization tokens, failed writes, and the UTF-8 settings budget.

Browser tests cover quick add, retained failed drafts, selective carry/replay, reminder dismissal persistence, combined filtering, eight-second deletion/undo and reload recovery, repeat generation/metadata/skip persistence, mobile ordering/overflow, downloads, midnight rollover, and pagination beyond 500 tasks. Browser time is fixed; deadline and midnight cases explicitly advance Playwright's clock instead of waiting in real time.

The baseline browser timezone is Asia/Shanghai. Dedicated UTC, America/Los_Angeles, and Pacific/Kiritimati cases put the device on a different calendar day, then verify Shanghai task grouping, Tuesday recurrence, +08 reminder entry, and exact timestamp preservation when editing. Recovery tests exercise lost add responses across reload, explicit retry of failed deletion, reconciliation of lost DELETE responses, late insert cancellation, preservation of today's skip when deleting yesterday, and filtering stale cancelled rows from both the UI and exports.

Desktop/mobile screenshots are saved to per-test directories under `test-results`; failures retain screenshots, context and traces there. To inspect a trace, run `npx playwright show-trace <trace.zip>`.
