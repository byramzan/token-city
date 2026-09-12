# Visual performance comparison

Measured in the Codex in-app Chromium browser on macOS, 1280×720. Baseline and
final use the same representative city route and fully loaded local world. The
final measurement used one active game tab and a rolling 300-frame sample; extra
animated WebGL tabs were closed so they could not distort the result.

Raw records: [`baseline-metrics.json`](baseline-metrics.json) and
[`final-metrics.json`](final-metrics.json).

| Metric | Before | Final | Change |
|---|---:|---:|---:|
| Average frame time | 32.75 ms | 9.19 ms | −71.9% |
| p95 frame time | 33.50 ms | 16.70 ms | −50.1% |
| Estimated FPS | 30.5 | 108.8 | +256.7% |
| Draw calls | 1,848 | 1,112 | −39.8% |
| Triangles | 31,640 | 19,338 | −38.9% |
| Renderer geometries | 1,293 | 1,447 | +11.9% |
| Texture objects | 38 | 112 | +74 intentional mapped surfaces |
| Shader programs | 8 | 9 | +1 controlled surface variant |
| Pixel ratio | 2.0 | 1.75 | capped for stable web performance |
| Active known flicker defects | 7 | 0 | all logged fixes verified |

The draw-call/triangle reduction primarily comes from replacing hundreds of
overlapping road boxes with one annular mesh per ring. Geometry object count can
be higher because the fully loaded shared world contains runtime-parametric
houses/interiors; it does not create a frame-time regression.

## Texture and build memory

- Surface library: 93 uploaded repeat/channel textures from 42 source canvases.
- Estimated surface-map GPU memory including mip levels: **41.50 MiB**.
- Baseline renderer exposed a count (38) but not reliable byte sizes; the older
  static audit bounded all decoded textures below 40 MiB. It is not presented as
  an exact measurement.
- Production `dist/`: **1.2 MiB** on disk after build.
- Largest minified chunk: `main-*.js`, 904.99 kB / 249.47 kB gzip. Vite reports
  the existing >500 kB advisory; it is a JavaScript code-splitting opportunity,
  not new texture data or a runtime correctness failure.
- Runtime maps are generated synchronously once during scene construction and
  cached. Camera movement performs no image/network fetch and showed no visible
  texture pop-in.

## Project budgets

The target is modern mobile/desktop WebGL2, with graceful WebGL fallback where
Three.js supports it. No explicit hardware SKU was specified by the product.
Derived visual budgets:

| Tier | Pixel ratio cap | Surface maps | All decoded textures | Shadows |
|---|---:|---:|---:|---|
| Low/mobile | 1.25 recommended | 48 MiB | 72 MiB | 1024² recommended |
| Standard/current | 1.75 | 64 MiB | 96 MiB | 2048² PCF at 20 Hz |
| High/desktop | 2.0 optional after profiling | 96 MiB | 128 MiB | 2048² |

The current build exposes one standard tier rather than a public quality menu.
The low/high rows are documented implementation limits, not active user-facing
switches. Change them only after testing the same camera path.

## Load and compilation

All surface profiles are visible in the hidden material deck and common shader
programs compile during initial construction. No new first-approach shader hitch
was observed. The route retains the existing short loader animation; no precise
network load metric is claimed because the development server and Convex state
are environment-dependent.
