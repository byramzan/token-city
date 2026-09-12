# Technical Specification: Complete House Builder and Interior Placement Rework

**Document type:** Standalone development task  
**Version:** 1.0  
**Language:** English  
**Scope:** House construction, multi-floor editing, structural parameters, openings, interior placement, validation, saving, and migration

---

## 1. Objective

Completely rework the current house-building system so that:

- interior objects are placed in correct, intentional locations instead of random spots;
- every floor of a multi-story house can be selected, viewed, and edited;
- walls, floors, ceilings, windows, doors, stairs, roofs, and interior objects use one compatible parametric system;
- changing one part of the house cannot silently break or overlap another part;
- invalid combinations are blocked before they are saved;
- the same saved house is reconstructed identically on every client;
- old houses can be migrated without deleting player progress.

The result must feel like a simple, controlled low-poly house editor rather than a random object generator.

---

## 2. Current Problems

The current implementation has the following defects:

1. Interior placement spots are selected randomly.
2. Furniture may appear:
   - in front of a door;
   - inside a wall;
   - over another object;
   - too close to stairs;
   - in an incorrect room;
   - with the wrong rotation;
   - outside the house.
3. A house may contain a second floor, but only the first floor can be edited.
4. Walls, windows, doors, floors, and roofs are not controlled by a shared set of structural variables.
5. A window or door may conflict with:
   - a wall corner;
   - another opening;
   - a floor slab;
   - stairs;
   - furniture;
   - the roof;
   - the exterior facade.
6. Structural changes may leave previously placed objects in invalid positions.
7. The builder does not clearly explain why a selected object cannot be placed.
8. Saved houses may depend on generated positions instead of stable object data.

These behaviors must be removed, not patched with additional random checks.

---

## 3. Core Design Principle

The house must be represented as structured data.

The required hierarchy is:

```text
House
 ├── Building footprint
 ├── Floors
 │    ├── Rooms
 │    │    ├── Floor surface
 │    │    ├── Ceiling surface
 │    │    ├── Wall segments
 │    │    │    ├── Windows
 │    │    │    └── Doors
 │    │    ├── Placement zones
 │    │    └── Interior objects
 │    ├── Stair opening
 │    └── Floor slab
 ├── Exterior doors and windows
 └── Roof
```

Every element must:

- have a stable unique ID;
- belong to a specific house and floor;
- use local house coordinates;
- declare its dimensions;
- declare its dependencies;
- expose collision and clearance bounds;
- be validated before creation or modification.

No structural element or interior object may exist only as an untracked scene object.

---

## 4. Coordinate System

Use one coordinate convention throughout the builder.

- `X`: horizontal direction across the house;
- `Y`: vertical height;
- `Z`: horizontal depth;
- house origin: center of the ground-floor footprint;
- floor origin: inherited from the house origin with a vertical offset;
- room and object transforms: stored relative to their parent floor.

All dimensions and positions must use the same unit system.

Recommended unit:

- `1.0 unit = 1 meter`.

Transforms must not be stored in a mixture of:

- world coordinates;
- prefab coordinates;
- parent-local coordinates;
- visual mesh offsets.

Visual mesh offsets may exist inside an asset prefab, but gameplay placement and saving must use the canonical local transform.

---

## 5. Canonical House Variables

Create a single `HouseDefinition` model. The client and backend must use the same schema version.

### 5.1. House-level variables

Required fields:

```text
houseId
ownerId
schemaVersion
templateId
footprintWidth
footprintDepth
floorCount
activeFloorId
foundationType
exteriorMaterialId
interiorMaterialSetId
roofType
roofMaterialId
roofHeight
globalWallThickness
defaultFloorHeight
entranceSide
worldPosition
worldRotation
revision
createdAt
updatedAt
```

### 5.2. Floor-level variables

```text
floorId
houseId
floorIndex
elevation
floorHeight
slabThickness
ceilingThickness
footprintPolygon
roomIds
stairOpeningId
visibilityState
revision
```

`floorIndex` starts at `0`.

Example:

- ground floor: `0`;
- second floor: `1`;
- third floor: `2`.

### 5.3. Room-level variables

```text
roomId
floorId
roomType
roomPolygon
ceilingHeight
floorMaterialId
wallMaterialId
ceilingMaterialId
wallSegmentIds
placementZoneIds
objectIds
```

Initial room types:

- living room;
- kitchen;
- bedroom;
- bathroom;
- office;
- hallway;
- utility room;
- unassigned.

The initial selection must remain small. Do not expose dozens of room types in the first release.

### 5.4. Wall variables

Every wall must be stored as a wall segment:

```text
wallId
floorId
roomIds
startPoint
endPoint
height
thickness
interiorMaterialId
exteriorMaterialId
isExterior
openingIds
loadClass
```

Derived values:

- length;
- direction;
- normal;
- center;
- bounding volume.

Derived values must be recalculated from `startPoint` and `endPoint`. They must not be saved as separate editable values.

### 5.5. Window variables

Windows must be attached to a wall, never positioned freely in world space.

```text
windowId
wallId
windowTypeId
offsetAlongWall
width
height
sillHeight
depth
frameMaterialId
interiorTrimId
exteriorTrimId
```

`offsetAlongWall` is measured from the wall start point.

The final transform is derived from:

- wall start point;
- wall direction;
- wall thickness;
- window offset;
- window dimensions;
- sill height.

### 5.6. Door variables

```text
doorId
wallId
doorTypeId
offsetAlongWall
width
height
depth
hingeSide
opensTowardRoomId
swingAngle
frameMaterialId
```

The door must provide:

- closed collision bounds;
- open-door sweep bounds;
- navigation portal;
- interaction point on both accessible sides.

### 5.7. Stair variables

```text
stairId
lowerFloorId
upperFloorId
stairTypeId
position
rotation
width
runLength
riseHeight
lowerClearance
upperClearance
openingPolygon
```

A second floor cannot be finalized unless it has a valid connection to the floor below.

### 5.8. Interior object variables

```text
objectInstanceId
itemDefinitionId
houseId
floorId
roomId
placementType
anchorId
localPosition
localRotation
scaleVariant
footprintBounds
clearanceBounds
interactionBounds
state
revision
```

An interior object must not save only a “random spot index.”

---

## 6. House Construction Flow

The construction process must use a fixed sequence. Each step may expose only a small number of meaningful choices.

### Step 1: Select the foundation

Initial choices:

1. Compact rectangle;
2. Wide rectangle;
3. L-shaped foundation.

The foundation defines:

- valid footprint;
- maximum room boundaries;
- supported floor count;
- roof compatibility;
- exterior wall loop.

### Step 2: Select the number of floors

Initial choices:

1. One floor;
2. Two floors.

A third floor should remain data-compatible but does not need to be available in the first release.

When two floors are selected:

- create both floor records immediately;
- create a valid stair opening;
- show both floors in the editor;
- allow switching to the second floor before completing the house.

### Step 3: Select a floor layout

Provide two or three layouts per foundation.

Each layout contains:

- room polygons;
- room types;
- interior walls;
- door locations;
- suggested furniture zones;
- stair position if required.

The user may change room types, but the first release does not require fully free wall drawing.

### Step 4: Select structural materials

Provide a small initial set:

- wood;
- brick;
- light stone;
- modern panels.

Each material must define:

- wall surface;
- corner trim;
- window trim compatibility;
- door-frame compatibility;
- floor-edge treatment;
- roof compatibility;
- texture and normal-map references;
- performance tier.

Changing a material changes visuals, not wall dimensions or saved opening positions.

### Step 5: Select the roof

Initial choices:

- gable roof;
- hip roof;
- flat roof.

Only compatible roofs should be displayed for the selected footprint and floor count.

### Step 6: Configure doors and windows

The system proposes valid default openings from the selected layout.

The user may:

- change an opening type;
- move it along its current wall;
- delete optional windows;
- add a window to a valid wall zone.

The user may not:

- detach a window from its wall;
- overlap two openings;
- place an opening across a wall corner;
- block the only required entrance;
- place a window through a floor slab or roof intersection.

### Step 7: Edit every floor

The floor selector must be available before interior placement.

The user can:

- select Ground Floor;
- select Second Floor;
- view both floors in a stacked preview;
- isolate one floor for editing;
- move between floors without losing unsaved changes.

### Step 8: Place the interior

Interior placement must use semantic placement rules described below.

### Step 9: Validate the complete house

Before completion, validate:

- structural geometry;
- openings;
- stairs;
- room access;
- object collisions;
- interaction access;
- navigation routes;
- budget and ownership;
- data consistency.

### Step 10: Save and build

Saving must be atomic.

Either:

- the entire validated revision is saved;

or:

- no part of the revision is applied.

---

## 7. Multi-Floor Editing

### 7.1. Floor selector

Add a persistent floor selector to the builder interface.

Example:

```text
[ Ground Floor ] [ Second Floor ]
```

The selected floor must be visually obvious.

Display:

- floor name;
- completion state;
- number of validation errors;
- number of unplaced required objects.

### 7.2. Floor visibility modes

Required modes:

1. **Isolate** — show and edit only the selected floor;
2. **Ghost Below** — show the floor below with reduced opacity;
3. **Stacked Preview** — show the complete building without editing;
4. **Cutaway** — hide the roof and upper floors above the selected floor.

Only objects on the active floor can receive editing input.

### 7.3. Editing the second floor

The second floor must support the same operations as the first:

- room selection;
- material selection;
- window and door editing;
- furniture placement;
- rotation;
- removal;
- validation;
- undo and redo.

The second floor must not be treated as a decorative prefab attached to the first floor.

### 7.4. Cross-floor validation

Validate between adjacent floors:

- stair alignment;
- stair opening alignment;
- floor slab openings;
- wall and column support rules;
- vertical window spacing;
- ceiling clearance;
- roof intersection;
- objects crossing the floor boundary.

An edit on one floor must trigger validation for:

- the active floor;
- the floor below;
- the floor above;
- stairs and openings connecting those floors.

---

## 8. Deterministic Interior Placement

### 8.1. Remove random placement

Do not choose interior positions through:

- random coordinates;
- random spot arrays;
- random rotations;
- the first free world position;
- mesh-center guesses.

The same room layout and the same saved object configuration must always produce the same result.

### 8.2. Placement types

Every item definition must support one or more explicit placement types:

- `Floor`;
- `Wall`;
- `Ceiling`;
- `Tabletop`;
- `Shelf`;
- `Counter`;
- `ExteriorGround`.

Examples:

- sofa: `Floor`;
- wall picture: `Wall`;
- ceiling lamp: `Ceiling`;
- mug: `Tabletop`;
- book: `Shelf`;
- cash register: `Counter`.

An item cannot be placed on an incompatible surface.

### 8.3. Placement zones

Each room layout must define semantic zones, not random spots.

Required zone examples:

- `LivingRoom.MainSeating`;
- `LivingRoom.SideFurniture`;
- `LivingRoom.WallDecoration`;
- `Kitchen.CookingLine`;
- `Kitchen.DiningArea`;
- `Bedroom.BedZone`;
- `Bedroom.StorageWall`;
- `Office.DeskZone`;
- `Hallway.ClearPath`;
- `Entrance.DropZone`.

Each zone contains:

```text
zoneId
roomId
allowedItemTags
prohibitedItemTags
polygon
preferredWallId
allowedRotations
maximumObjectCount
minimumSpacing
priority
```

### 8.4. Anchors

Use anchors for precise relationships.

Examples:

- a bed anchors its headboard to a valid wall;
- a sofa faces the room focus point;
- a television anchors to a wall opposite a seating zone;
- a dining chair anchors to a table seat point;
- a lamp anchors to a table socket;
- a painting anchors to an unobstructed wall interval.

Required anchor types:

- wall anchor;
- corner anchor;
- room-center anchor;
- parent-object socket;
- ceiling anchor;
- floor-grid anchor.

### 8.5. Placement ranking

Automatic placement may be offered, but it must be deterministic.

The system must:

1. find zones compatible with the item;
2. reject invalid zones;
3. generate candidate positions on the placement grid;
4. validate every candidate;
5. score valid candidates;
6. select the highest-scoring candidate;
7. use stable IDs as the final tie-breaker.

Suggested scoring:

```text
score =
    roomTypeCompatibility
  + zonePriority
  + preferredWallAlignment
  + focalPointAlignment
  + navigationClearance
  + spacingQuality
  - doorProximityPenalty
  - windowBlockingPenalty
  - crowdingPenalty
```

No random number may be used in this calculation.

### 8.6. Manual placement

The user must also be able to position an object manually.

Required behavior:

- drag the object within its valid room;
- snap to a configurable grid;
- snap wall items to their wall plane;
- snap child objects to parent sockets;
- rotate only through valid rotation increments;
- show a green preview when valid;
- show a red preview when invalid;
- display a short reason for invalid placement.

Initial rotation increments:

- floor furniture: 90 degrees;
- small tabletop decoration: 15 degrees;
- wall decoration: aligned to wall;
- doors and windows: derived from wall direction.

### 8.7. Room boundaries

An object footprint must remain completely inside its room unless its item definition explicitly allows a doorway or multi-room placement.

Visual mesh overhang is allowed only when:

- collision bounds remain valid;
- it does not cross a wall;
- it does not block a path;
- it does not enter another room.

---

## 9. Item Definition Requirements

Every placeable item needs an approved `ItemDefinition`.

Required fields:

```text
itemDefinitionId
displayName
category
allowedRoomTypes
placementTypes
footprintSize
visualBounds
collisionBounds
clearanceBounds
interactionBounds
allowedRotations
wallClearance
doorClearance
windowClearance
stairClearance
requiresParentSocket
providedSocketTypes
interactionType
navigationEffect
assetReference
lodReferences
version
```

### Bounds must be separate

- **Visual bounds:** visible mesh size;
- **Collision bounds:** physical blocking volume;
- **Clearance bounds:** empty space required around the item;
- **Interaction bounds:** space required by a resident to use the item.

A single oversized bounding box must not be reused for all four purposes.

### Pivot requirements

- floor object pivot: bottom-center;
- wall object pivot: rear-center at attachment surface;
- ceiling object pivot: top-center;
- tabletop object pivot: bottom-center;
- door and window pivot: defined relative to wall opening;
- stairs pivot: lower entry center.

All content assets must follow these pivot rules before being added to the game.

---

## 10. Collision and Clearance Rules

Before an object can be placed, validate it against:

1. room polygon;
2. floor surface;
3. walls;
4. windows;
5. doors;
6. door swing areas;
7. stairs;
8. stair openings;
9. other objects;
10. resident navigation paths;
11. interaction points;
12. ceiling height;
13. floor above and below where relevant.

### Mandatory clearances

Initial configurable values:

- main walking path: at least `0.8 m`;
- secondary walking path: at least `0.6 m`;
- door approach: at least `0.8 m`;
- stair entry and exit: at least `1.0 m`;
- interactable object approach: at least `0.6 m`;
- large furniture separation: at least `0.1 m`;
- wall decoration from opening edge: at least `0.15 m`.

These values must be stored in configuration rather than hard-coded in multiple systems.

---

## 11. Doors, Windows, and Wall Conflict Prevention

### 11.1. Valid wall interval

Each wall must calculate free intervals after reserving:

- corner margins;
- structural margins;
- existing door openings;
- existing window openings;
- stair intersections;
- roof restrictions.

Windows and doors can only be added inside a free interval.

### 11.2. Opening validation

An opening is valid only when:

```text
offsetAlongWall >= startMargin

offsetAlongWall + openingWidth <= wallLength - endMargin

openingTop <= wallHeight
```

It must also satisfy:

- no overlap with another opening;
- minimum gap from another opening;
- valid sill height;
- valid lintel space;
- compatible wall type;
- no stair conflict;
- no floor-slab conflict;
- no roof conflict.

### 11.3. Automatic mesh rebuilding

When an opening changes:

1. update opening data;
2. validate the transaction;
3. rebuild the affected wall mesh;
4. rebuild trims;
5. update collision;
6. update navigation;
7. revalidate nearby furniture;
8. render the final result.

Do not create a decorative window mesh on top of an unmodified solid wall.

### 11.4. Wall thickness

Windows and doors must derive their depth from the host wall thickness.

Changing the global or individual wall thickness must:

- update opening depth;
- update frames and trims;
- update connected corner geometry;
- revalidate adjacent furniture;
- preserve the opening’s horizontal wall offset.

---

## 12. Dependency and Conflict System

Every editable element must declare what it depends on.

Examples:

- window depends on wall;
- wall decoration depends on wall;
- table lamp depends on table socket;
- second-floor stairs depend on both connected floors;
- roof depends on the top-floor footprint;
- upper-floor furniture depends on its floor slab.

### Parent deletion

When a parent is removed:

- do not silently leave children in world space;
- show affected child objects;
- require confirmation;
- remove or move child objects in the same transaction;
- refund or return owned items according to economy rules.

### Parent modification

When a parent changes:

1. simulate the new state;
2. find affected children;
3. attempt a deterministic valid reposition only if the user enabled that option;
4. otherwise mark the affected edit as blocked;
5. explain the conflict;
6. let the user move or remove the conflicting object.

Purchased furniture must never disappear because a wall or room changed.

---

## 13. Validation Pipeline

All placement and structural changes must use the same validation service.

Required order:

1. schema validation;
2. ownership validation;
3. asset-definition validation;
4. parent-existence validation;
5. floor and room compatibility;
6. surface compatibility;
7. bounds validation;
8. structural intersection validation;
9. opening validation;
10. clearance validation;
11. navigation validation;
12. interaction-access validation;
13. cross-floor validation;
14. budget validation when a purchase is involved;
15. revision and concurrency validation.

The preview, final placement, backend save, and server reconstruction must use equivalent rules.

The client provides immediate feedback, but the backend remains authoritative.

---

## 14. Navigation Validation

After every structural or large-object change:

- update the local navigation representation;
- confirm that every room remains reachable from the main entrance;
- confirm that stairs connect the required floors;
- confirm that required resident interaction points remain reachable;
- confirm that a door can be approached from each required side.

Do not require a full expensive navigation rebuild for every preview frame.

Use:

- fast local clearance checks during dragging;
- a final navigation validation after placement;
- an asynchronous full rebuild after a valid save if required by the engine.

The save must be rejected if the final state traps residents or makes a required room inaccessible.

---

## 15. Editor Interface

### Required builder layout

The interface must include:

- current construction step;
- selected floor;
- floor visibility controls;
- category list;
- small item selection panel;
- house viewport;
- selected-object controls;
- undo and redo;
- validation messages;
- total cost;
- save or build button.

### Selected-object controls

Depending on the selected element:

- move;
- rotate;
- change variant;
- change material;
- duplicate where allowed;
- remove;
- move to valid zone;
- reset to suggested position.

### Error messages

Use specific messages:

- “This sofa blocks the doorway.”
- “This window is too close to the wall corner.”
- “The stair exit must remain clear.”
- “This item can only be placed on a table.”
- “The second floor is not connected to the ground floor.”
- “This wall change conflicts with two interior objects.”

Do not display only:

- “Invalid position”;
- “Error”;
- “Cannot place.”

---

## 16. Undo, Redo, and Drafts

Every builder action must be represented as a command.

Examples:

- add object;
- move object;
- rotate object;
- remove object;
- change material;
- move opening;
- change window type;
- switch layout;
- change floor count.

Requirements:

- at least 30 undo steps;
- redo support;
- switching floors does not clear history;
- draft autosave;
- reopening a draft restores the selected floor and camera;
- undo and redo never duplicate purchased objects;
- economy transactions occur only when the final purchase or build action is confirmed.

---

## 17. Save Model and Backend Authority

The backend stores:

- canonical house structure;
- all floors;
- all rooms;
- wall segments;
- openings;
- stairs;
- interior object instances;
- asset-definition versions;
- schema version;
- latest revision.

The backend must not trust client-provided validity flags.

### Save request

Every save request includes:

```text
houseId
baseRevision
schemaVersion
operations
clientValidationVersion
idempotencyKey
```

### Save response

```text
houseId
newRevision
acceptedOperations
canonicalHouseState
warnings
```

### Concurrency

If `baseRevision` is outdated:

- reject the save with a revision conflict;
- do not overwrite the newer house;
- reload the canonical state;
- preserve the user’s unsaved operation list where possible.

---

## 18. Deterministic Reconstruction

A saved house must reconstruct identically:

- after restarting the game;
- on another device;
- for another player visiting the house;
- on the server;
- after changing graphics quality.

The saved model must not rely on:

- runtime object order;
- frame timing;
- non-seeded randomness;
- current camera direction;
- physics settling;
- locally generated temporary IDs.

Physics may animate movable decorative objects during gameplay, but the builder’s canonical placement must remain deterministic.

---

## 19. Existing House Migration

Create a migration process for houses made with the old system.

### Migration flow

1. Load the old house in a migration environment.
2. identify its foundation, floor count, and closest supported layout;
3. convert structural elements to the new schema;
4. assign every object to a floor and room;
5. validate every old object;
6. preserve a valid object position when possible;
7. move invalid objects to the nearest deterministic compatible zone;
8. if no zone is valid, return the item to the player’s inventory;
9. produce a migration report;
10. save only after successful validation.

### Migration rules

- never delete a purchased item;
- never randomly reposition an item;
- never place all old second-floor objects on the first floor;
- keep a backup of the old house state;
- allow migration rollback during the controlled rollout period.

---

## 20. Asset Authoring Rules

Before any structural asset or interior object is released, it must pass an authoring checklist.

### Structural prefab checklist

- canonical dimensions;
- correct origin and pivot;
- compatible wall thickness range;
- opening cutout metadata;
- collision mesh;
- LODs;
- material slots;
- corner connection test;
- floor and roof intersection test;
- first-floor and second-floor test.

### Interior item checklist

- correct category and room tags;
- correct placement types;
- visual bounds;
- collision bounds;
- clearance bounds;
- interaction bounds;
- correct pivot;
- valid rotations;
- supported parent sockets;
- resident interaction point;
- navigation test;
- low-poly performance test.

An asset with incomplete placement metadata must not appear in the production item catalog.

---

## 21. Performance Requirements

The new validation system must not create visible editor lag.

Requirements:

- use spatial partitioning for collision queries;
- validate only affected rooms and adjacent floors during previews;
- cache static wall and room geometry;
- rebuild only affected wall meshes;
- do not rebuild the entire house while dragging one chair;
- do not load hidden-floor high-detail assets unnecessarily;
- use LODs outside edit mode;
- batch compatible low-poly materials;
- avoid creating a unique material instance for every wall or object.

Target behavior:

- placement preview responds within one rendered frame under normal house complexity;
- final local validation completes without a visible freeze;
- switching floors does not reload the entire house;
- opening and closing the editor does not change object positions.

---

## 22. Recommended Implementation Modules

Separate the system into the following modules:

```text
HouseDataModel
HouseTemplateLibrary
HouseBuilderController
FloorEditorController
StructuralGeometryBuilder
OpeningPlacementService
InteriorPlacementService
PlacementCandidateScorer
CollisionValidationService
ClearanceValidationService
NavigationValidationService
CrossFloorValidationService
HouseSaveService
HouseMigrationService
BuilderHistoryService
AssetDefinitionRegistry
```

Do not put all placement, rendering, purchasing, and saving logic into one house controller.

---

## 23. Required Test Matrix

Test every supported combination of:

- foundation type;
- one or two floors;
- layout;
- wall material;
- roof type;
- window type;
- door type;
- stair type;
- room type;
- item placement type.

### Mandatory scenarios

1. Edit and furnish only the second floor.
2. Switch between floors repeatedly without losing edits.
3. Place a bed correctly against every valid bedroom wall.
4. Attempt to place a sofa through a wall.
5. Attempt to block the main entrance.
6. Attempt to put a picture across a window.
7. Move a window toward a wall corner.
8. Change wall thickness after placing a window.
9. Change a room material without moving furniture.
10. Replace a one-floor house with a two-floor version.
11. Validate stair access in both directions.
12. Remove a table that has child objects.
13. Edit a wall that supports wall decorations.
14. Save, reload, and compare all transforms.
15. Visit the same house from another account.
16. Migrate an old one-floor house.
17. Migrate an old two-floor house.
18. Restore purchased objects that cannot be migrated.
19. Trigger two save requests with the same idempotency key.
20. Trigger a save using an outdated house revision.

---

## 24. Acceptance Criteria

The task is complete only when all of the following are true.

### House structure

1. The house uses a versioned parametric data model.
2. Every floor, room, wall, opening, stair, and object has a stable ID.
3. Walls use start and end points plus explicit height and thickness.
4. Windows and doors are attached to wall IDs.
5. Opening transforms are derived from their host walls.
6. Changing visual materials does not corrupt structural geometry.
7. Invalid structural combinations cannot be saved.

### Multi-floor editing

8. A two-floor house creates two editable floor records.
9. The user can select and edit the second floor.
10. The second floor supports the same furniture tools as the first.
11. Switching floors does not lose changes.
12. Cutaway, isolate, ghost-below, and stacked-preview modes work.
13. Stairs and floor openings are validated across both floors.
14. The roof does not block second-floor editing.

### Interior placement

15. Interior objects are never assigned random positions.
16. Items use semantic rooms, zones, anchors, and compatible surfaces.
17. Automatic placement is deterministic.
18. Manual placement provides snapping and a live validity preview.
19. Furniture cannot intersect walls, openings, stairs, or other furniture.
20. Furniture cannot block required resident paths.
21. Wall items cannot cover windows or doors.
22. Tabletop items require valid parent sockets.
23. Invalid placement displays a specific reason.

### Conflict handling

24. Moving a door revalidates nearby furniture.
25. Changing wall thickness updates connected openings.
26. Editing one floor revalidates relevant adjacent-floor structures.
27. Removing a parent identifies all dependent objects.
28. Purchased items are never silently deleted.
29. No structural change leaves untracked scene objects.

### Saving and migration

30. The backend independently validates all saved changes.
31. Saves use revision checking and idempotency.
32. A save is applied atomically.
33. The same house reconstructs identically on every client.
34. Existing houses can be migrated to the new schema.
35. Invalid migrated items return to player inventory.
36. Old two-floor houses retain objects on their correct floors.

### Performance

37. Dragging one item does not rebuild the entire house.
38. Switching floors does not reload the full scene.
39. Repeated editing does not create duplicate material instances.
40. The builder remains responsive at the supported maximum house complexity.

---

## 25. Delivery Plan

### Phase 1: Data foundation

- create the versioned house schema;
- implement stable IDs and local coordinates;
- implement floors, rooms, walls, and openings;
- create the asset-definition registry.

### Phase 2: Structural editor

- implement foundation and layout selection;
- implement wall, window, door, stair, and roof rules;
- implement structural and cross-floor validation.

### Phase 3: Multi-floor interface

- add floor selection;
- add visibility modes;
- enable complete second-floor editing;
- add floor-aware undo, redo, and drafts.

### Phase 4: Interior system

- create semantic zones and anchors;
- implement deterministic candidate scoring;
- implement manual placement and snapping;
- implement collision, clearance, interaction, and navigation checks.

### Phase 5: Backend and saving

- implement authoritative validation;
- implement revisions and idempotent saves;
- implement deterministic reconstruction;
- add analytics and error reporting.

### Phase 6: Migration and rollout

- migrate internal test houses;
- run the full compatibility matrix;
- migrate a limited player cohort;
- verify inventory recovery;
- roll out to all houses;
- retain rollback data for the agreed safety period.

---

## 26. Definition of Done

The feature is ready for release when a player can:

1. select a simple foundation and layout;
2. build a one-floor or two-floor house;
3. edit every available floor;
4. place furniture intentionally in valid room locations;
5. understand every rejected placement;
6. edit windows, doors, walls, materials, stairs, and the roof without producing conflicts;
7. save and reopen the house without any object moving;
8. let another player visit and see the same layout;
9. migrate an existing house without losing purchased items.

The main release requirement is not merely that objects look correct. The saved structure, collision state, navigation state, interaction state, and backend representation must all agree.
