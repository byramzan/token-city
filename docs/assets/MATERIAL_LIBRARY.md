# Material library

The single runtime source of surface maps and quality limits is
`src/materialLibrary.js`. It generates deterministic original CanvasTextures;
there are no remote texture requests and no external model files.

## Master categories

| Surface | Size | Anisotropy | Roughness | Metalness | Bump |
|---|---:|---:|---:|---:|---:|
| grass | 512 | 8 | 0.98 | 0 | 0.018 |
| asphalt | 512 | 8 | 0.96 | 0 | 0.012 |
| pavers | 256 | 8 | 0.94 | 0 | 0.018 |
| soil | 256 | 4 | 0.98 | 0 | 0.018 |
| sand | 256 | 4 | 0.96 | 0 | 0.012 |
| wood | 256 | 4 | 0.86 | 0 | 0.022 |
| floorWood | 256 | 8 | 0.82 | 0 | 0.018 |
| brick | 256 | 4 | 0.91 | 0 | 0.028 |
| stone | 256 | 4 | 0.94 | 0 | 0.024 |
| tech | 256 | 4 | 0.72 | 0.08 in house material | 0.010 |
| roof | 256 | 8 | 0.90 | 0 | 0.026 |
| plaster | 256 | 2 | 0.96 | 0 | 0.008 |
| fabric | 128 | 2 | 0.98 | 0 | 0.012 |
| ceramic | 128 | 2 | 0.68 | 0 | 0.006 |
| metal | 128 | 2 | 0.58 | 0.56 | 0.006 |
| plastic | 128 | 2 | 0.72 | 0 | 0.006 |
| bark | 128 | 4 | 0.96 | 0 | 0.024 |
| foliage | 128 | 2 | 0.93 | 0 | 0.010 |

All color maps are sRGB. Roughness and height are linear `NoColorSpace` data.
Maps repeat, generate mipmaps, use trilinear minification and linear
magnification. Effective anisotropy is capped by both the profile and the GPU,
with a project maximum of 8×.

## Channel convention

Each surface uses three independent RGBA8 canvases: color, roughness and height.
Height is connected as a subtle `bumpMap`; it is not displacement or parallax.
Metalness is a scalar because only the controlled metal category needs it.
AO and normal maps are intentionally absent: the simple procedural geometry has
no baked lightmap pipeline, and additional maps did not justify their memory or
shader cost. Alpha is reserved for real transparency such as sun sprites/glass.

## Reuse rules

- `surfaceMaps(kind, repeat)` returns cached texture objects for an exact kind,
  channel and repeat pair.
- `house.js#mat` caches the resulting `MeshStandardMaterial` by color/options.
- Item labels are cached by text and appearance.
- Window glass is a single plane, `depthWrite:false`; opaque walls and frames stay
  opaque and must never share the glass material.
- Do not mutate a shared texture repeat or material after retrieval. Request a
  new repeat variant or clone only when per-object animation is required.

## Adding a surface

1. Add one `SURFACE_PROFILES` entry with the smallest useful 128/256/512 size.
2. Add a deterministic, seamless branch to `drawSurface` for color/roughness/height.
3. Add the ID to `tests/materialLibrary.test.js`.
4. Apply it through `surfaceMaps` or the `textureKind` option to `mat`.
5. Review `?visual-test=1` at day and `?visual-test=1&time=night`.
6. Pan and zoom at shallow angles; confirm no shimmer.
7. Run `npm test` and `npm run build`, then refresh manifests with
   `?visual-audit=1` if the asset list changed.

## Runtime budget

The representative city creates 93 repeat/channel texture objects from 42 source
canvases. Their measured estimated surface-map GPU footprint, including mipmaps,
is 41.50 MiB. The standard-tier budget is 64 MiB for material maps and 96 MiB
for all decoded runtime textures/signs; the low-tier goal is 48/72 MiB. If a city
grows beyond the current content scale, nameplates should be reduced or atlased
before increasing any surface resolution.

