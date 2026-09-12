# Visual asset sources and licenses

## Runtime assets

All runtime 3D geometry, material maps, in-world UI canvases, signs, sky sprites
and item art are original project code generated locally at runtime. They are
covered by the repository's ISC package license. No third-party texture pack,
photograph, marketplace model, font file, brand asset or remote image is bundled.

| Family | Source | License/source record | Attribution |
|---|---|---|---|
| Surface maps | `src/materialLibrary.js` | Original deterministic project code | None |
| Houses/businesses | `src/house.js` | Original procedural project code | None |
| City/environment | `src/city.js` | Original procedural project code | None |
| Interiors | `src/interior.js` | Original parametric project code | None |
| Furniture/props | `src/items.js` | Original procedural project code | None |
| Runtime signs/UI textures | house/items/city modules | Original canvas drawing | None |

## AI-generated reference

`docs/assets/art-direction-reference.png` was generated with OpenAI image
generation for internal art-direction comparison. It is not read, copied,
sampled or shipped by the runtime build. The prompt and role are recorded in
`ART_DIRECTION.md`.

## Reuse restrictions

Do not add scraped web images, token-logo URLs, recognizable brands, protected
characters, marketplace files without a local commercial-use license record, or
AI output containing text/logos/watermarks. New third-party assets must be stored
locally, include author/source URL, license text, modification permission and
attribution requirements in this file, and pass the same technical audit.

