# Token City — developer guide

This is the practical entry point for the project after the task6 visual-asset
rework. It describes the shipped code and settings, not a planned engine rewrite.
The detailed audit, manifests and evidence live under [`docs/`](docs/texture-audit.md).

## 1. Project overview

Token City is a browser-based multiplayer low-poly town game. A player connects
an EVM wallet on **Robinhood Chain**, creates or selects an account, builds a house on a shared plot,
furnishes authored interior sockets, opens a business, buys from other players
and moves value between project tokens and the existing in-game coin supply.
Residents, household needs/HP, visits and a day/night city simulation make the
shared world active around the economic loop.

Major systems:

- procedural city, houses, businesses, environment and residents;
- parametric one/two-floor/attic house definitions and deterministic placement;
- interior/yard editor with stable item IDs and sockets;
- ledger, household budget, businesses, inventory and player-to-player settlement;
- Robinhood Chain (EVM, chain id 4663 / testnet 46630) wallet connection, ERC-20
  deposits through an audited vault and withdrawals to a verified linked wallet;
- Convex realtime world documents, trades and private chain state over WebSocket;
- Vercel Functions for the admin session, the sanitized public token
  configuration and the server-rendered operations console;
- protected operations page at `token-admin.html` (server-rendered, session-gated);
- centralized procedural material library and hidden visual QA routes.

The runtime is **Three.js r185** with `WebGLRenderer`, built by **Vite 5.4.21**.
It targets modern desktop and mobile browsers. WebGL hardware acceleration is
required; the app shows a readable fallback if WebGL creation fails. The current
art direction is stylized semi-realistic low-poly: warm, painterly, believable
and deliberately below photorealism.

## 2. Run and build

Requirements: Node.js 20+ recommended, npm, and a modern Chromium/Safari/Firefox
browser with WebGL. Install dependencies and start development:

```bash
npm install
npm run dev -- --host 127.0.0.1 --port 5175
```

Open `http://127.0.0.1:5175/`. Production packaging:

```bash
npm test
npm run build
```

The static output is `dist/`. The task6 result was not deployed by this change.

### Environment configuration

Never commit real values, seed phrases, pool signers, private keys or admin
passwords. Development uses `.env.local`; Vercel uses encrypted environment
variables. Relevant names are:

- `VITE_CONVEX_URL` — browser Convex deployment URL; required for multiplayer.
- `VITE_CONVEX_SITE_URL` and `CONVEX_DEPLOYMENT` — Convex deployment metadata.
- `CONVEX_DEPLOY_KEY` — deployment-only secret.
- `TOKEN_CITY_ADMIN_PASSWORD` and `TOKEN_CITY_ADMIN_SESSION_SECRET` — protected
  admin page login/session values.
- `CHAIN_SERVICE_SECRET` — shared secret for Vercel Function → Convex admin
  calls. The same value must be set in the Convex deployment environment.
- `RHC_RPC_HTTP_URL_TESTNET` / `RHC_RPC_HTTP_URL_MAINNET` — production provider
  endpoints (Convex environment). The public rate-limited RPC is the fallback
  and is acceptable for development only.
- `RHC_SIGNER_PRIVATE_KEY` / `RHC_SIGNER_REFERENCE` — withdrawal signer. A raw
  key is development and testnet only; mainnet requires the managed signer.
- `WALLETCONNECT_PROJECT_ID` — optional; without it the WalletConnect option is
  hidden rather than broken.
- `TOKEN_CITY_DEVNET_POOL_B64`, `KV_REST_API_URL` / `KV_REST_API_TOKEN` —
  retained read-only Solana history (see `docs/TASK8_MIGRATION.md`).

The complete list of names lives in [`.env.example`](.env.example).
- Vercel-managed `VERCEL_OIDC_TOKEN` and Redis compatibility variables may be
  present locally but are not consumed as public browser configuration.

Local `.token-city-*.local.json` and `wallet-access/` files are sensitive test
material. Keep mode 0600, never expose them from `public/`, screenshots or docs.

To verify the actual two-client backend flow without leaving test data:

```bash
node --env-file=.env.local scripts/verify-multiplayer.mjs
```

## 3. Folder structure

| Path | Responsibility |
|---|---|
| `index.html` | Game shell, HUD, builder/interior panels and entry script |
| `token-admin.html` | Hidden password-protected network/C/A operations UI |
| `src/main.js` | Renderer, mode lifecycle, UI orchestration, world sync |
| `src/city.js` | Main scene, camera, roads, terrain, lighting, fog, plots |
| `src/house.js` | Procedural houses, roofs, glass, companion businesses |
| `src/houseModel.js` | Stable parametric floor plans, openings and placement sockets |
| `src/interior.js` | Interior scene, floors/walls/stairs, editor and placement preview |
| `src/items.js` | Procedural furniture/prop visual builders |
| `src/materialLibrary.js` | Surface profiles, maps, filtering and visual quality caps |
| `src/visualTestScene.js` | Hidden controlled day/night material deck |
| `src/visualAudit.js` | Hidden runtime model/texture inventory generator |
| `src/residents.js`, `dialogues.js`, `audio.js` | Residents and presentation systems |
| `src/state.js`, `ledger.js`, `market.js` | Save/account/economy state |
| `src/multiplayer.js`, `server/worldProtocol.js` | Client sync and payload normalization |
| `src/chain/` | EVM wallet discovery, EIP-1193 session and the client chain service |
| `server/chain/` | Chain registry, EVM primitives, ABIs, finality, quotes, SIWE, deposit verification, `RobinhoodChainAdapter` |
| `server/conversion.js` | Versioned Game Coin conversion rule, shared by client and server |
| `server/doorGeometry.js`, `server/interiorSnapshot.js` | Pure geometry and interior-diff rules shared with the tests |
| `contracts/` | `TokenCityVault.sol` deposit vault and its review gate |
| `src/solana.js`, `walletProviders.js` | Retired Solana layer, kept unimported for history and rollback |
| `convex/` | Realtime schema, world mutations, chain state (`chain.js`) and chain actions (`chainActions.js`) |
| `api/` | Vercel Functions: admin session, protected admin API, server-rendered console, public token config |
| `server/` | Shared server-side validation/config helpers |
| `scripts/` | Test-wallet/pool utilities and live multiplayer verifier |
| `tests/` | Node test suite, including material/profile budgets |
| `docs/assets/` | Manifests, QA evidence, reference image and supporting reports |
| `vite.config.js`, `vercel.json` | Local middleware, build entries and deployment routing |

There are no imported scene, model, prefab, shader-file or source-model folders.
Models/scenes are JavaScript-generated. “Prefab” equivalents are builder functions
such as `createHouse`, `createCompanion`, `buildItem` and `HouseDefinition`.
Shaders are Three.js `MeshStandardMaterial`/`MeshBasicMaterial` programs; no GLSL
source is maintained. Runtime texture source is code in `materialLibrary.js`.

## 4. Scene and system map

1. `main.js` creates the renderer and configures the material library.
2. `City`, `Residents` and `Interior` scenes are constructed; the city is active.
3. State loads locally, then `createWorldMultiplayer` joins the Convex world.
4. A snapshot validates/imports public house documents and subsequent WebSocket
   updates add/change/remove houses, interiors and businesses in real time.
5. Mode switches select one renderer target:
   - **city:** `city.scene` + orbit/WASD camera;
   - **builder:** `previewScene` + staged house option preview;
   - **interior:** `interior.scene` + floor/cutaway/stacked editing views;
   - graph view stays within the city and changes fog/dimming.

The blockchain layer is deliberately separated from the game: `src/chain/`
prepares wallet requests and displays state, `server/chain/` holds the rules,
`convex/chainActions.js` is the only place that speaks to an RPC endpoint or
holds a signer, and `convex/chain.js` holds the canonical records. A game module
must never import an RPC client, an ABI or a chain-id literal.

The house's saved config is the gameplay contract. Visual mesh triangles are not
used as physics colliders. Plot selection/interactions use the stable plot index;
interior collision/placement uses authored room/opening/socket metadata from
`houseModel.js`. A visual rebuild must preserve those IDs and dimensions.

Shop purchases are validated against catalog stock and price, then the existing
coin balance moves buyer → seller after settlement. The Solana layer funds or
withdraws against configured token/pool rules; private signer material is never
sent to the browser. Refer to `README.md` for the broader economy/admin flow.

Hidden QA routes (not linked in normal UI):

- `?visual-test=1` — all material families and representative objects;
- `?visual-test=1&time=night` — same deck under night-compatible lighting;
- `?interior-test=1` — deterministic furnished interior;
- `?visual-audit=1` — JSON model/texture inventory.

## 5. Art direction

The exact target is: **stylized semi-realistic low-poly game art with believable
materials, soft detail, readable shapes, restrained surface noise and a cohesive
slightly painterly warm finish**.

Required principles:

- medium saturation outdoors, calmer interiors, warm neutral construction colors;
- broad macro variation before micro detail;
- roughness defines fabric/wood/metal more than strong bumps;
- clean/light wear only; no grime, photogrammetry or cinematic damage;
- no albedo highlights, hard shadows, text, logos or perspective distortion;
- normal camera distance 10–110 units is the approval range;
- day, sunset, night and interior lighting must all remain readable.

Correct treatments include simplified grain, broad asphalt aggregate, soft grass
clusters and restrained tile mortar. Incorrect treatments include photographic
blades, tiny high-contrast gravel, strong parallax, opaque black glass, deep
scratches or patterns that exist only to look detailed in a close-up.

Full palette/response and the generated sample record:
[`docs/assets/ART_DIRECTION.md`](docs/assets/ART_DIRECTION.md).

## 6. Texture pipeline

### Current production format

Production surface maps are deterministic CanvasTexture RGBA8 canvases of 128,
256 or 512 px. No disk image loader or texture streaming layer exists. Generated
color maps are sRGB; roughness/height maps are linear `NoColorSpace`. Mipmaps are
required, minification is `LinearMipmapLinear`, magnification is `Linear`, and
tiling surfaces use `RepeatWrapping`. Ground/roof anisotropy is 8×, other surfaces
2–4×, capped by GPU capability.

Channels are separate color, roughness and height. Height is a low-strength bump
map. Metalness is a scalar. Do not add AO/normal/alpha merely to fill a PBR set;
alpha is allowed only for an actually transparent/emissive element.

### Resolution and texel-density bands

- terrain and long shallow-angle roads: 512 px tiling;
- building walls/roof/floor/pavers: 256 px tiling;
- normal furniture and small props: 128–256 px shared tiles;
- hero in-world text: 512×256 maximum when readability proves it necessary;
- no runtime source above 512 px without a measured exception.

Nearby surfaces should share apparent frequency. Adjust `textureRepeat`, not
source resolution, to correct physical scale. A wall board/brick should remain
proportional to doors and residents. Directional wood must use a repeat/orientation
that follows the modeled surface.

### Source/export/compression rules

For the current pipeline, accepted source is the deterministic Canvas 2D drawing
code. PNG is acceptable for documentation/reference but is not automatically a
runtime asset. If static files are introduced, prefer PNG for authored masks or
WebP for opaque color, store source/license locally, add an explicit loader and
use power-of-two dimensions for repeated mipmapped maps. KTX2/Basis is the
recommended future mobile compression route after a measured loader migration;
today the browser uploads RGBA8.

Naming: `tc_<surface>_<channel>_<repeat>` for generated texture names; surface
profile IDs use lower camel case (`floorWood`). Runtime UI labels should have a
stable content cache key. Atlas entries, if introduced, require at least 8 px
source padding at 512 px, edge dilation through all mip levels and no Repeat wrap
across sub-rects. There is no production atlas today.

### Add or replace a texture

1. Update/add the profile and `drawSurface` branch in `src/materialLibrary.js`.
2. Keep the function seamless: draw edge-crossing features with the `tiled` helper.
3. Generate all three used channels without baked directional light.
4. Add/update the required ID in `tests/materialLibrary.test.js`.
5. Apply through `surfaceMaps` or `mat(..., { textureKind, textureRepeat })`.
6. Review both visual-test routes, then the actual city/interior camera.
7. Update manifests if IDs/settings changed.

All final profiles are listed in
[`docs/assets/MATERIAL_LIBRARY.md`](docs/assets/MATERIAL_LIBRARY.md) and every
texture record is in
[`docs/assets/TEXTURE_MANIFEST.csv`](docs/assets/TEXTURE_MANIFEST.csv).

## 7. Material and shader pipeline

`src/materialLibrary.js` is the master surface library. `surfaceMaps(kind, repeat)`
returns cached color/roughness/bump texture objects. `house.js#mat` then caches a
`MeshStandardMaterial` by color and options. `items.js#itemMat` maps known
furniture colors to wood/fabric/metal/foliage/ceramic, otherwise controlled
plastic. Interior structural materials have their own per-floor cache and are
disposed when the interior is rebuilt.

Parameter meaning:

- `textureKind`: one `SURFACE_PROFILES` ID;
- `textureRepeat: [u,v]`: physical pattern scale without mutating shared UVs;
- `roughness`, `metalness`, `bumpScale`: profile defaults, overridden only with
  a visual/physical reason;
- `transparent`, `opacity`, `depthWrite`: reserved for glass/ghost/effect layers;
- `emissive`, `emissiveIntensity`: signs, screens and lights only.

Render modes:

- opaque environment/building/interior/furniture: Standard material, depth write;
- foliage: opaque low-poly geometry today, no alpha cutout;
- glass: one plane, restrained tint/opacity, `transparent:true`, `depthWrite:false`;
- terrain: opaque tiled Standard material, 8× anisotropy;
- emissive: controlled Standard/Basic material without an unnecessary map;
- decals: not implemented; add distinct geometry only with a real physical offset
  or a deliberate decal strategy, never a coplanar plane.

Do not mutate a cached shared material for one house. Add a cache-keyed option or
clone only for a per-instance animated property (night-window/sign glow). Keep
shader variants around the measured final count of 9. A new shader family must
justify its gameplay-visible value and be opened once in the material deck so it
does not compile on first camera approach.

## 8. 3D model pipeline

Current models are procedural primitives/BufferGeometry:

- 1 unit = 1 metre; +Y up; items face +Z;
- pivot/origin is on the contact plane where practical;
- house footprint, plot index, `doorX`, floor IDs, room IDs, openings and sockets
  are stable gameplay data and must survive a visual change;
- generated primitives provide UV0; custom geometry must provide non-stretched
  UV0 and valid normals;
- the project uses runtime lighting, not baked lightmap UVs;
- mesh geometry is not a physics collider; placement footprints come from config;
- staged-build parts preserve `userData.order`; optional animation tags include
  `spin`, `blink`, `smoke`, `flag`, `water` and `jet`;
- save/catalog IDs must never change to rename a visual.

There are no skeletons, imported tangents, navmesh files or LOD groups. Three.js
frustum culling uses generated bounds. Current low-poly houses/items do not
benefit enough from LOD to offset extra variants. If a future hero model exceeds
roughly 10k triangles or is repeated hundreds of times, add `THREE.LOD` with
aligned pivot/bounds/material response and hysteresis/crossfade testing; only one
level may be visible at a time.

### Safely replace a model

1. Record the existing entry from `ASSET_MANIFEST.csv` and its config/catalog ID.
2. Duplicate/version the builder function; do not change saved IDs.
3. Preserve dimensions, contact pivot, forward axis, footprint, `doorX`, animation
   tags and any placement socket/anchor contract.
4. Rebuild only the geometry needed for silhouette, UV separation or defect removal.
5. Supply UV0/normals and separate physical material groups (for example roof vs soffit).
6. Test city/builder/interior, construction animation, save/reload, multiplayer
   visitor rendering and item ownership before switching references.
7. Update the generated manifest and remove the superseded builder only after
   string/reference searches confirm no callers.

If imported content is added later, use glTF 2.0/GLB, Y-up/metre scale, no embedded
unlicensed images, deterministic node names and locally recorded license/source.
The current Vite project has no GLTF/DRACO/KTX loader, so that is an explicit new
pipeline change rather than a drop-in file copy.

## 9. Flicker troubleshooting

Use this order:

1. Reproduce with a fixed camera and classify whether the artifact follows
   geometry, texture detail, transparent sorting, lighting/shadow or distance.
2. Temporarily use a simple opaque material. If the shape still fights, inspect
   duplicate/coplanar faces and mesh intersections before changing a texture.
3. Put the original material on a clean plane/box and pan at the same angle.
4. Check UV0, face orientation/normals, mipmaps, min filter, anisotropy and repeat.
5. Disable transparent/effect layers; glass must be a single non-coplanar plane.
6. Check road/path/decal heights in wireframe and depth order.
7. If LOD is added in future, log the active level, align bounds/pivots and test
   around both sides of every threshold without repeated switching.
8. Check shadow-only movement with the camera fixed; use the documented bias and
   update cadence before touching albedo.
9. Repeat stationary, slow/fast pan, shallow angle and min/max zoom tests.
10. Record root cause and evidence in `FLICKER_FIX_LOG.md`.

Project-specific confirmed causes were overlapping ring boxes, curved plot/path
overlap, roof material wrapping onto soffits, thick/coplanar glass, high-frequency
ground marks, transparent-by-default interiors, per-frame moving shadow maps and —
for door openings — unstable transparent sorting on the ghosted front wall plus
same-facing coplanar faces at window frame corners.

Two coincident faces only fight when they face the **same** way. A butt joint
puts two faces on one plane with opposite normals; each is back-face culled from
the other's side and nothing fights. Overlapping opaque wall pieces "to be safe"
creates the same-facing pair that does fight — check the normals before changing
geometry.
See [`docs/assets/FLICKER_FIX_LOG.md`](docs/assets/FLICKER_FIX_LOG.md).

Do not keep arbitrary large `polygonOffset`, disable the depth buffer, globally
raise near clip, blur every texture, remove all shadows, or hide a surface as a
permanent fix. Those approaches mask the cause and break other camera conditions.

## 10. Quality and performance settings

Current standard tier (`VISUAL_QUALITY`):

- renderer antialiasing: `antialias:true` (MSAA where supported);
- pixel ratio cap: 1.75;
- color/tone mapping: sRGB + ACES Filmic, exposure 1.06;
- camera: 50° perspective, near 0.1, far 400, distance 10–110;
- surface sources: 128/256 px, grass/asphalt 512 px;
- anisotropy maximum: 8;
- shadows: PCF, 2048×2048, 20 Hz, radius 1.5, bias −0.00012,
  normal bias 0.035, shadow camera 160×160, near 4/far 200;
- daylight cycle: 30 minutes;
- fog far: 180–255 by phase, near at 65%; graph mode far ×1.35;
- post-processing: none beyond tone mapping;
- texture streaming/compressed container: none; maps are cached local canvases.

Measured representative result:

- average 32.75 → 9.19 ms; p95 33.5 → 16.7 ms;
- draw calls 1,848 → 1,112; triangles 31,640 → 19,338;
- shaders 8 → 9; texture objects 38 → 112;
- surface-map GPU estimate 41.50 MiB; production build 1.2 MiB on disk;
- 136 shared material cache keys after the complete representative city loads.

Budgets: current standard surface maps ≤64 MiB and all decoded textures ≤96 MiB.
Recommended future low tier is DPR 1.25, 1024² shadows, ≤48/72 MiB; high tier may
use DPR 2 only after device profiling. The app currently exposes one tier, not a
user-facing quality selector. Full comparison and caveats:
[`docs/assets/PERFORMANCE_COMPARISON.md`](docs/assets/PERFORMANCE_COMPARISON.md).

## 11. Manual modification recipes

### Change grass

Edit the `grass` profile and `kind === 'grass'` branch in
`src/materialLibrary.js`. Keep 512 px, macro patches, edge-tiled features and
8× anisotropy unless a measured target requires less. Do not add more tiny blades.
Check city roads/plots and both material-test lighting routes.

### Change a house wall material

Find the wall `mat(...)` assignment in `src/house.js#createHouse`. Change its
`textureKind`/repeat or scheme color without changing `cfg.material`, scheme IDs,
dimensions or build-order tags. Build every material variant using
`?visual-audit=1`; inspect corners/windows at day and night.

### Replace a roof model

Version `prism`/`shedRoofBox` in `src/house.js`. Preserve total footprint/height,
contact placement and `userData.order`. Keep sloped roof, gable/fascia and soffit
as deliberate material groups; do not wrap the tile map under the roof. Test
gable/shed/flat plus solar/antenna/balcony options and min/max zoom.

### Update furniture texture

Use `itemMat` in the relevant `BUILDERS.<itemId>` function in `src/items.js`.
Prefer an existing surface category or add one centrally. Never change the item
ID or config cost/slot metadata for a visual update. Verify placement preview,
confirmation, reload, both floors and yard if applicable.

### Change bump/normal strength

The project uses bump, not normal maps. Change the surface profile `bumpScale` in
`materialLibrary.js`; keep it 0–0.03 and validate grazing light. A local override
is allowed only through a separately keyed material option. If adding a normal
map, import it as linear data, validate tangent orientation and add a manifest/test
record—do not assume AI-generated normals are physically correct.

### Change texture resolution for a quality tier

Today size is a profile property and one standard tier is active. Change only
`profile.size`, keep power-of-two 128/256/512, rerun the budget test and record
new memory. For a real selector, create separate profile tables before canvas
creation and reload the scene when tier changes; do not resize an uploaded shared
canvas in place.

### Add a material variant

Add a profile/drawing branch only if its physical response differs from existing
categories. Otherwise reuse an existing `textureKind` with color/repeat. Update
`tests/materialLibrary.test.js`, the material deck, texture manifest and this
guide. Keep new shader features opt-in so unrelated assets do not receive them.

### Repair an atlas entry

No atlas is active. If one is introduced, fix the source sub-rect, add ≥8 px
dilated padding at 512 px, regenerate every mip, keep sub-rect UVs inside the
safe area and use Clamp rather than Repeat across entries. Test extreme zoom and
transparent neighbours. Document atlas dimensions, entry IDs and license.

### Roll back a replacement

This folder is currently **not a Git worktree**. Before future visual work,
initialize/attach version control and commit a known-good baseline. To roll back,
restore only the affected builder/material module and its manifest record; never
replace `.env.local`, local wallet files, shared-world data or unrelated user
changes. Re-run tests/build and the same evidence route before deleting the bad
version. Do not use broad destructive reset commands in a dirty workspace.

### Verify any visual change

Run `npm test`, `npm run build`, open day/night material routes, the normal city
and the deterministic interior. Repeat stationary, slow/fast pan, zoom and shallow
ground angle. For structural/item changes, build/save/reload and connect a second
session or run the multiplayer verifier. Record any new root cause instead of
writing “texture replaced.”

## 12. Asset and license information

Every shipped runtime visual is original deterministic project code. No external
texture/model marketplace content is bundled and no runtime remote image is
loaded. The art-direction PNG is AI-generated reference only and is not sampled
or shipped by the application. Its exact final prompt is recorded in the art
direction file.

Complete source/license table:
[`docs/assets/LICENSES.md`](docs/assets/LICENSES.md). Model and texture inventories:
[`ASSET_MANIFEST.csv`](docs/assets/ASSET_MANIFEST.csv),
[`TEXTURE_MANIFEST.csv`](docs/assets/TEXTURE_MANIFEST.csv), and
[`VISUAL_AUDIT.json`](docs/assets/VISUAL_AUDIT.json).

Any third-party addition must allow commercial game use and modification, be
stored locally, include author/source/license/attribution and contain no protected
brand/character or accidental AI text/logo/watermark. Never copy user token art
or metadata URLs directly into the 3D world without a separate rights/security
review.

## 13. Known limitations and future work

- The production main JavaScript chunk remains about 905 kB minified (249 kB
  gzip); Vite emits a non-blocking >500 kB code-splitting advisory.
- Runtime canvas RGBA8 maps have no KTX2/Basis compression or streaming. Current
  128–512 px budgets are measured and acceptable; world growth may justify a
  static compressed tile pipeline.
- One standard visual tier is active. Low/high values are documented budgets,
  not yet selectable UI tiers.
- Physical testing on a low-end phone and a discrete desktop GPU was unavailable;
  browser QA used macOS Chromium at 1280×720. Run the documented matrix before a
  store-quality release.
- No LOD system exists because current low-poly assets do not materially benefit.
  Reassess only for substantially denser or far more numerous future assets.
- Runtime nameplates/business signs remain per unique text and can dominate
  decoded texture memory if the town grows beyond roughly 100 buildings; reduce
  them to 256×128 or implement a padded dynamic atlas first.
- Imported GLB/source-model and shader-file pipelines do not exist. Introducing
  them requires an explicit loader, license, compression and save-contract plan.
- The project directory is not currently under Git. Add version control before
  the next asset replacement cycle so non-destructive rollback is available.
- The Robinhood Chain deposit vault (`contracts/TokenCityVault.sol`) has not
  been deployed or independently reviewed. No mainnet activation may happen
  before both are complete — see `contracts/README.md`.
- The Game Coin ledger remains client-side (`src/ledger.js`), inherited from the
  earlier tasks. The chain layer only feeds it server-verified amounts keyed by
  the server-issued deposit id, so a credit cannot be replayed; rebuilding the
  ledger server-side is a separate piece of work.
- Testnet wallet-by-wallet connection tests and the mainnet low-value smoke test
  still have to be run against a deployed token and vault
  (`docs/TASK8_MIGRATION.md`).

Chain migration details, the audit table and the remaining manual steps are in
[`docs/TASK8_MIGRATION.md`](docs/TASK8_MIGRATION.md).

Final verification details are in
[`docs/assets/REGRESSION_RESULTS.md`](docs/assets/REGRESSION_RESULTS.md); baseline
and after screenshots are under [`docs/assets/screenshots/`](docs/assets/screenshots/).

