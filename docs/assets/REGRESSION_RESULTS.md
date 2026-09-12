# Regression and visual verification

Date: 2026-08-29. Runtime: Three.js r185, Vite 5.4.21, Codex in-app Chromium.

## Automated

- `npm test`: **40/40 passed**.
- `npm run build`: **passed**, 366 modules transformed.
- `node --env-file=.env.local scripts/verify-multiplayer.mjs`: **passed**;
  two WebSocket clients observed a house, business, concurrent stock/price
  changes, player trade and replaceable payment sessions; test records were removed.
- Browser console on a fresh fully loaded game route: no application errors or
  warnings; only Vite connection debug messages.
- `tests/materialLibrary.test.js` checks all 18 surface profiles, size,
  anisotropy, roughness, bump limits and furniture material inference.
- Existing tests cover atomic/revision-safe house saves, deterministic sockets,
  floor connectivity, stale placement normalization, HP/economy, wallets,
  multiplayer documents/business payloads and idempotent purchases.

## Visual routes and evidence

| Check | Route/evidence | Result |
|---|---|---|
| Baseline city | `screenshots/before-city.png` | recorded before changes |
| Normal city/day | `screenshots/after-city.png` | pass |
| Slow/fast pan | `screenshots/after-camera-pan.png` | pass, no road/plot bands |
| Zoom/min-max range | `screenshots/after-camera-zoom.png` | pass, patterns stable |
| Interior movement | `screenshots/after-interior.png` | pass, opaque sorting stable |
| All material families/day | `?visual-test=1`, `material-test-scene.png` | pass |
| Material families/night | `?visual-test=1&time=night`, `material-test-night.png` | pass |
| Full runtime inventory | `?visual-audit=1` | 84 model/family records, 58 texture records |

The camera review included stationary observation, orbit, shallow road/grass
angles, slow and fast pan, zoom in/out, city movement and interior orbit. Day,
night, warm transition lighting, fog, shadows and transparent glass were checked.
There are no active LODs, decals, imported atlases, water surface textures or
external model transitions to test.

## Gameplay contracts

- House construction and staged animation: pass through existing creation/save tests.
- First/second floor structure and editing: pass.
- Interior socket placement and stale save remapping: pass.
- Object footprints/ownership: unchanged stable catalog IDs; pass.
- Resident visuals/navigation: visual geometry does not replace navigation data;
  representative city movement reviewed.
- Shops/businesses, purchasing, settlement and HP: automated pass.
- Save/load, multiplayer document validation and live two-client flow: automated pass.
- Day/night, fog and moving shadows: visual pass.
- Production packaging: pass.

## Known advisories

- Vite flags the existing main JavaScript chunk as larger than 500 kB; future
  work can split Solana/game modules. This does not block the visual rework.
- A real matrix of low-end phones and discrete desktop GPUs was not available.
  Conservative caps and the documented low-tier recipe should be verified on
  physical target devices before a store-quality launch.
- Development mode has no runtime texture compression container (KTX2/Basis).
  The current 128–512 px procedural RGBA8 budget is acceptable; if the world
  scale grows, migrate static tiles only after measuring browser support.
