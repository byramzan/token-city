# Flicker and rendering defect log

Evidence paths are relative to the repository. The before view is
`docs/assets/screenshots/before-city.png`; repaired city/interior/material views
are in the same folder.

## TF-001 — roof underside bands

- **scene:** city and builder preview
- **objectId:** `house.roof.gable`, `house.roof.shed`
- **reproductionSteps:** orbit below a roof edge, then pan slowly across it
- **cameraConditions:** grazing upward angle, medium/close distance
- **confirmedRootCause:** one high-frequency roof material wrapped over sloped
  faces, fascia and underside; the undersurface sampled dense lines at a shallow angle
- **affectedAssets:** `src/house.js#prism`, `shedRoofBox`
- **implementedFix:** rebuilt roof material groups; roof maps only the intended
  top/sloped faces, while gables/fascia/soffits use calm opaque materials
- **beforeEvidence:** `before-city.png` and supplied roof bug screenshot
- **afterEvidence:** `after-city.png`, `after-camera-zoom.png`
- **performanceImpact:** no additional geometry; controlled shared material slots
- **verificationStatus:** passed slow/fast pan and zoom

## TF-002 — black/flickering windows and storefront glass

- **scene:** city exterior, companion businesses, interior
- **objectId:** exterior/interior window groups and storefronts
- **reproductionSteps:** orbit past a window or view it near another transparent layer
- **cameraConditions:** oblique view, day/night transition
- **confirmedRootCause:** thick glass boxes, solid frame backing and transparent
  layers intersected or sorted against the wall/storefront
- **affectedAssets:** `src/house.js`, `src/interior.js`
- **implementedFix:** one outward-offset front-facing glass plane, open frame bars,
  `depthWrite:false`, restrained opacity/tint; structural surfaces remain opaque
- **beforeEvidence:** `before-city.png` and supplied black-house screenshots
- **afterEvidence:** `after-city.png`, `after-interior.png`, material test scenes
- **performanceImpact:** fewer glass faces and no duplicate transparent backing
- **verificationStatus:** passed day/night and interior/exterior tests

## TF-003 — plot/path triangular stripes

- **scene:** garden plot entrances
- **objectId:** walkway junctions and plot pads
- **reproductionSteps:** pan across the path where it meets a pad/fence corner
- **cameraConditions:** medium zoom, shallow ground angle
- **confirmedRootCause:** coplanar/overlapping path pieces and rectangular plot
  corners meeting on a curved ring
- **affectedAssets:** `src/city.js#_plotPadGeometry`, walkway placement
- **implementedFix:** authored tapered octagonal pad footprint, deliberate small
  height separation and non-overlapping junction geometry
- **beforeEvidence:** supplied corner screenshots
- **afterEvidence:** `after-camera-pan.png`, `after-camera-zoom.png`
- **performanceImpact:** neutral; stable reusable geometry
- **verificationStatus:** passed all ring sectors at min/max camera distance

## TF-004 — ring-road moving triangles

- **scene:** city ring streets
- **objectId:** `environment.street_network`
- **reproductionSteps:** pan around a ring joint or zoom along the road tangent
- **cameraConditions:** shallow angle over asphalt
- **confirmedRootCause:** a chain of boxes had slightly overlapping coplanar top
  faces at every segment boundary
- **affectedAssets:** `src/city.js#_streets`
- **implementedFix:** each ring is now one `RingGeometry` with world-planar UVs;
  avenues and rings have deliberate non-coplanar heights
- **beforeEvidence:** `before-city.png`
- **afterEvidence:** `after-city.png`, `after-camera-pan.png`
- **performanceImpact:** major draw-call and triangle reduction
- **verificationStatus:** passed complete orbit and fast pan

## TF-005 — grass/road texture shimmer

- **scene:** whole city
- **objectId:** grass, yards, asphalt and pavers
- **reproductionSteps:** pan or zoom while looking across terrain/roads
- **cameraConditions:** normal gameplay distance and shallow angle
- **confirmedRootCause:** high-frequency, high-contrast procedural marks with
  inconsistent sampling settings
- **affectedAssets:** old generators in `src/city.js`
- **implementedFix:** central deterministic painterly maps with restrained
  frequency, macro variation, mipmaps, trilinear filtering and 8× ground anisotropy
- **beforeEvidence:** `before-city.png`
- **afterEvidence:** all after screenshots and day/night material deck
- **performanceImpact:** +surface-map memory; no synchronous loading, maps cached
- **verificationStatus:** passed stationary, slow/fast pan and zoom

## TF-006 — interior transparency sorting

- **scene:** interior editor and look-inside mode
- **objectId:** walls, floors, furniture and placement ghosts
- **reproductionSteps:** change floors/view modes and orbit through furniture
- **cameraConditions:** overlapping interior objects
- **confirmedRootCause:** ordinary opaque interior materials were all created with
  `transparent:true`, creating unnecessary sorting and depth ambiguity
- **affectedAssets:** `src/interior.js`
- **implementedFix:** opaque by default; transparency/depth-write toggled only for
  placement ghosts and restored afterward; local caches disposed on rebuild
- **beforeEvidence:** previous interior behavior
- **afterEvidence:** `after-interior.png`
- **performanceImpact:** fewer transparent passes and no repeated cache leak
- **verificationStatus:** passed first/second-floor edit and rebuild tests

## TF-007 — rapidly crawling shadows

- **scene:** city day/night cycle
- **objectId:** directional sun shadow atlas
- **reproductionSteps:** keep camera still near fences/lamps and watch shadow edges
- **cameraConditions:** any daylight phase
- **confirmedRootCause:** moving sun position caused a 2048² shadow atlas refresh
  on every animation frame; normal bias was too sensitive at low-poly corners
- **affectedAssets:** `src/city.js#_lights`, `City.update`
- **implementedFix:** PCF shadows, bias `-0.00012`, normalBias `0.035`, radius
  `1.5`, controlled 20 Hz refresh while keeping the 30-minute cycle continuous
- **beforeEvidence:** supplied shadow screenshots
- **afterEvidence:** `after-city.png` and fixed-camera observation
- **performanceImpact:** fewer shadow rasterizations and lower frame-time spikes
- **verificationStatus:** passed fixed-camera day cycle observation

## Not applicable after audit

There are no active decals, imported normal/tangent maps, texture atlases, external
meshes or LOD groups. Therefore no LOD crossfade, atlas bleed, wrong normal format
or imported-face defect was found. Frustum culling remains Three.js-native; adding
LOD to current low-poly props would cost more complexity than it saves.


## 2026-09-07 — Door openings (task8 §22)

**Symptom.** A texture shimmered or crawled around door openings while the
camera moved. Reported for interior doorways; reproduced from both sides, at
near and far distance, on ground and upper floors.

**Classification.** The artifact followed geometry and transparency, not the
image texture. Replacing the door material with a flat opaque colour did not
remove it; hiding the ghosted front wall did.

**Confirmed root causes.**

1. *Transparent sort instability on the ghosted front wall.* The front wall is
   drawn with `opacity: 0.13` and `depthWrite: false` and was built from
   `BoxGeometry` pieces. Around an opening those boxes meet, so two blended
   faces sat on one plane; three.js re-sorts transparent meshes by distance
   every frame, the order flipped as the camera orbited, and the doorway edge
   crawled. A second transparent shell — the ghost jamb and header at
   `opacity: 0.2`, also without depth write — was stacked on top of it.
2. *Same-facing coplanar faces at window frame corners.* The vertical and
   horizontal frame bars shared a depth of `WALL_T + 0.02`, so their front
   faces coincided where they crossed. Two faces with the same normal at the
   same depth is a true z-fight.
3. *Per-opening wall slicing.* The wall was cut into a separate piece above
   every opening, multiplying the seams that (1) and (2) act on.

**Ruled out.** The butt joints between opaque wall pieces and the door frame.
Those coincident faces point away from each other and are back-face culled, so
they never fight. Overlapping them "to be safe" would have created the
same-facing coplanar faces that do fight, so the opaque wall deliberately keeps
its butt joints.

**Fix.**

- Ghost walls are single-sided `PlaneGeometry` with a fixed ascending
  `renderOrder` — no end faces, no per-frame sorting between neighbours.
- The ghosted wall no longer receives a transparent door frame.
- Above the tallest opening the wall is one continuous band across its whole
  length (`wallBandBottom` in `server/doorGeometry.js`).
- Jambs and header are embedded into the wall and into each other, so no face
  is shared anywhere around the opening.
- Window frame bars use different depths so their corners interpenetrate.
- Frame parts cast and receive shadows consistently with the wall.
- The exterior house door had the same self-overlap: the header and the jamb
  shared their top, side and front planes. It is now seated 4 cm into the wall
  with interpenetrating parts.

**Not used.** No `polygonOffset`, no depth-buffer change, no raised near clip,
no blurred texture, no disabled shadows, no hidden surface.

**Gameplay contract.** Opening geometry, `doorX`, room ids, sockets and
clearances are unchanged, so collision and resident navigation are unaffected.

**Regression test.** `tests/doorwayGeometry.test.js` rebuilds the boxes
`Interior#_buildWall` emits and fails on any *same-facing* coincident face that
is not buried inside another solid — across door widths, opening heights, wall
thicknesses, mixed door/window walls, every material and every kit.
