# Task 7 implementation and verification

Verified 2026-09-07. Production: https://token-city.vercel.app/

Deployment `dpl_HrsJc5VhSpRd2jTxixv89aZBauyc` reached READY. The production migration processed 10 existing houses. Temporary QA homes and the temporary production environment file were removed; original environment files and wallet vaults were not changed.

## Implemented

- One family per new account-owned house; dedicated 1–5 floor selector, modular roofs/walls, 4/6/8/10/12 residents and 1/2/2/3/3 consumption units.
- Server-timed initial construction and replay-safe floor extensions. Residents join only after the completion event. Existing floors retain stable placement IDs.
- Private household subscriptions, authoritative active/background/offline decay, capped offline loss, distinct need timings, 30/10/0 thresholds, sequential crisis recovery and paid emergency availability.
- Family-sized product/service catalog, finite stock/capacity, storage limits, explicit product use and timed visit completion, recovery previews and deterministic ranked recommendations.
- Per-floor authored sockets, exact model pivots and dimensions, reserved navigation/stair/opening clearances, opaque final placement previews, floor-aware cameras and visibility modes.
- Atomic interior saves against the placement revision; independent storefront updates do not invalidate an unchanged interior. Older WebSocket versions cannot overwrite newer state.
- Schema-4 migration retains owned legacy furniture in the house inventory instead of guessing new coordinates.
- Periodic material wrapping, calmer roof undersides, actual stair slab holes and nonoverlapping trim/wall joins.

## Evidence

- `npm test`: 65 passing tests, including the foundation/layout/window-kit/floor matrix, furniture dimensions/pivots, stair openings, recovery rates, crises, use idempotency and existing ledger tests.
- `npm run build`: successful. Existing bundle-size warning remains; the large 3D/wallet bundle is not a correctness error.
- `scripts/verify-task7.mjs`: passed against development and production Convex deployments. Two independent WebSocket clients observed initial construction, completion, floor extension, storefront stock and canonical furniture changes. Repeated create/extension/purchase/use calls were idempotent. Verification records are removed in `finally`.
- Browser: demo coin funding, five-floor construction, private family panel, fifth-floor editing, removal to house inventory, preview and confirmation, both menus closing, server-confirmed save, and reconstruction in a second tab.
- Production browser starts successfully with an empty page-error list. Vercel deployment reached READY. Post-deploy Vercel error-log query returned no logs; this is not a long-term monitoring guarantee.

## Operating notes

Run locally with `npm run dev -- --host 127.0.0.1 --port 5175`. Opening `index.html` as a file does not start the application.

Vercel's build runs Convex deployment with production credentials. Local `.env.local` targets a separate development backend; do not mistake local test results or migration calls for production changes.

Household access keys are private capability values and are never placed in the public world document. New houses register them atomically. Legacy accounts predate a server-verified wallet ownership binding; first household registration retains that compatibility model. This is a remaining security limitation of legacy identity, not a financial or wallet-authentication redesign. Reserve backing, withdrawals, commission accounting and existing financial infrastructure remain out of task 7 scope; the tests here do not certify real-money security.

The test results cover the listed scenarios, not every possible browser, extension, graphics driver or concurrent financial failure. No claim of universally bug-free gameplay is made.
