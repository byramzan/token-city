# Technical Specification: Family Needs, Player Business Demand, House Floors, Residents, and Deterministic Interiors

**Document type:** Standalone implementation task  
**Version:** 1.0  
**Language:** English  
**Game type:** Browser-based multiplayer game  

---

## 1. Purpose

Rework the family-needs loop, player-business demand, floor selection, resident capacity, and house interior placement.

The intended gameplay loop is:

1. A player builds one family house.
2. The house receives a standardized number of residents based on its floor count.
3. The family has four needs that decrease over time.
4. The player clicks businesses in the world and buys goods or services to restore those needs.
5. Most goods and services are sold by other players.
6. When a need reaches zero, the family enters a focused crisis state and unrelated recovery actions become unavailable until the critical need is restored.
7. The player may initially build from one to five floors and may add floors later.
8. Every floor has its own editable interior and strict, authored furniture slots.

The system must motivate regular trade without requiring complex character controls. This is a browser game: the player selects a business, selects an offer, confirms the purchase, and receives the corresponding effect.

---

## 2. Out of Scope

This task must not redesign or implement:

- Game Coin reserve backing;
- token-to-Game-Coin conversion;
- Game-Coin-to-token withdrawal;
- double-entry accounting;
- escrow architecture;
- platform commission accounting;
- financial refund implementation;
- the previous slow free-recovery system.

Treat the existing Game Coin balance and purchase infrastructure as available dependencies. This task defines gameplay rules and the purchase results that the existing financial layer must execute.

---

## 3. Core Product Rules

1. One house represents one family.
2. Additional floors extend the same family; they do not create separate apartments or households.
3. Every new house starts with at least four residents.
4. Every additional completed floor adds two residents.
5. A house may contain from one to five floors.
6. The player chooses floor count during a dedicated construction step.
7. The current separate “two-story house” option must be removed from the house-type selection.
8. A second or later floor may be added after the original house has been completed.
9. All floors must be editable.
10. Furniture placement must never use random positions or random rotations.
11. The four needs belong to the family gameplay loop and create demand for player-owned businesses.
12. A zero need creates a temporary crisis lock, not death, eviction, destruction, or loss of ownership.

---

## 4. Standard Family Size

Use one predictable formula:

```text
residentCount = 4 + ((floorCount - 1) × 2)
```

Required result:

| Floors | Residents | Family interpretation |
|---:|---:|---|
| 1 | 4 | Core family |
| 2 | 6 | Extended family |
| 3 | 8 | Large family |
| 4 | 10 | Multi-generational family |
| 5 | 12 | Maximum extended family |

The family remains one household at every size.

### 4.1. Resident creation timing

For initial construction:

- create the correct resident count only after the complete house is successfully built;
- do not create residents while the building is still under construction;
- all connected clients see the completed building through the existing real-time construction system.

For a later floor extension:

- the new floor is constructed first;
- its required residential interior slots must exist;
- two residents are added only after construction completes;
- adding the floor must be visible to other connected players in real time;
- repeated WebSocket events must not add the same residents twice.

### 4.2. Gameplay impact of a larger family

Additional residents must:

- appear inside and around the same house;
- participate in family animations;
- increase the quantity of goods required by the household;
- increase business visit activity;
- occupy valid sleeping and seating slots;
- never generate withdrawable Game Coins automatically.

Additional residents must not create passive money, daily token rewards, or repeatable financial rewards merely because they exist.

---

## 5. Family Need Model

Use four household-level bars:

1. **Hunger**
2. **Energy**
3. **Knowledge**
4. **Family Bond**

Use `Knowledge` in the interface instead of `Intelligence`. A person should not appear to permanently lose intelligence because the family did not buy a book. The value represents current mental stimulation and learning activity.

Use `Family Bond` instead of `Family Friendship`. It represents the relationship of the family as a whole.

### 5.1. Value range

Every need uses a decimal value from `0.0` to `100.0`.

```text
Minimum: 0
Maximum: 100
```

The interface may display rounded whole numbers, but the backend calculation must retain decimal precision.

### 5.2. Need states

| Value | State | UI behavior |
|---:|---|---|
| 71–100 | Comfortable | Calm bar, no warning |
| 31–70 | Normal | Standard display |
| 11–30 | Low | Visible warning and suggested businesses |
| 1–10 | Critical | Strong warning and highlighted recovery action |
| 0 | Crisis | Crisis Focus Mode is activated |

### 5.3. Household-level calculation

The game should not display four separate bars for every resident. A five-floor house would otherwise require 48 visible need bars.

Use four family-level bars for the primary interface. Residents may visually perform different actions, but the household need state remains the authoritative gameplay value.

Family size affects how many product or service units are required to receive the full recovery effect; it does not make the bars decay several times faster.

---

## 6. Need Timings

### 6.1. General timing rule

Use eight hours as the baseline time for the fastest need to fall from 100 to 0 during active simulation.

Do not make all four bars reach zero after exactly eight hours. If they begin together and decay at the same speed, the family will enter a complete crisis at once and every business will receive demand at the same moment.

Required starting timings:

| Need | Time from 100 to 0 | Base decay per active hour |
|---|---:|---:|
| Hunger | 8 hours | 12.5 |
| Energy | 10 hours | 10.0 |
| Knowledge | 14 hours | 7.14 |
| Family Bond | 18 hours | 5.56 |

These values are initial balancing parameters. Store them in server configuration rather than hard-coding them in several client systems.

### 6.2. Active simulation time

Full-speed decay applies while:

- the player has an active game session;
- the family simulation is running;
- the browser is connected to the game;
- the backend has not marked the session as disconnected.

The backend is authoritative for elapsed time.

Do not calculate needs from:

- the client's device clock;
- animation frame count;
- WebSocket message frequency;
- an interval that disappears when the tab is throttled.

### 6.3. Background and offline time

To avoid punishing players for sleeping or closing the browser:

- a hidden but connected browser tab uses 25% of normal decay speed;
- a disconnected account uses 10% of normal decay speed;
- one offline period may remove no more than 25 points from any need;
- Family Bond does not decrease while fully offline;
- reopening the game must not immediately set the whole family to zero.

The backend calculates the capped offline change when the household is loaded again.

### 6.4. Update frequency

Persist:

```text
householdId
hunger
energy
knowledge
familyBond
lastCalculatedAt
simulationState
activeCrisisNeed
needConfigVersion
stateRevision
```

Recalculate values:

- when the player opens the game;
- when a purchase is completed;
- when a product is used;
- when a service visit completes;
- when a need crosses a warning threshold;
- once per server-defined simulation interval;
- before returning the household state to the client.

Do not write four database rows every second.

---

## 7. Family-Size Consumption Standard

Larger houses create greater demand by requiring more product or service units, not by making needs collapse extremely quickly.

Use:

```text
familyConsumptionUnits = ceil(residentCount / 4)
```

| Residents | Required family units |
|---:|---:|
| 4 | 1 |
| 6 | 2 |
| 8 | 2 |
| 10 | 3 |
| 12 | 3 |

A standard family product covers one unit, which represents up to four residents.

Examples:

- a four-resident family needs one food basket for the full effect;
- a six-resident family needs two food baskets or one Large Family Basket;
- a twelve-resident family needs three standard units or one Extended Family package.

Businesses may sell bundled versions. A bundle should be slightly cheaper than buying every unit separately, but it must consume the corresponding amount of business stock or service capacity.

The interface must show the required family size before confirmation.

Example:

```text
Family size: 6
Required servings: 6
This product covers: 4
Result: partial recovery
```

---

## 8. Recovery Effects

Goods and services restore needs only after they are used or completed.

Buying a product and receiving its gameplay effect must be separate states where applicable.

### 8.1. Example effects

Initial balancing values:

| Product or service | Primary effect | Secondary effect |
|---|---:|---:|
| Grocery Basket | +35 Hunger | None |
| Bakery Meal | +25 Hunger | None |
| Restaurant Family Meal | +45 Hunger | +8 Family Bond |
| Coffee | +30 Energy | None |
| Café Family Visit | +20 Energy | +8 Family Bond |
| Rest Center Visit | +45 Energy | None |
| Book | +25 Knowledge | None |
| Library Session | +40 Knowledge | None |
| Flower Gift | +30 Family Bond | None |
| Family Entertainment Visit | +45 Family Bond | None |

Effects must be configurable.

### 8.2. Partial family coverage

If an item covers fewer residents than the family contains, scale the household effect:

```text
finalEffect = baseEffect × min(coveredResidents / residentCount, 1)
```

Example:

```text
Family residents: 8
Food basket coverage: 4
Base Hunger recovery: 35
Final Hunger recovery: 17.5
```

### 8.3. Usage rules

- food must be consumed before Hunger changes;
- a book must be read before Knowledge changes;
- flowers must be given to another family member before Family Bond changes;
- a service must complete before its effect is applied;
- one item cannot be used twice;
- a repeated client message cannot apply an effect twice;
- values are capped at 100;
- the UI shows the expected result before confirmation.

### 8.4. Storage limits

Do not allow unlimited stockpiling that removes the need to visit businesses for months.

Initial household storage limits:

- food products: 8 family units;
- energy products: 6 family units;
- unread books: 6;
- unused flower gifts: 4;
- service visits cannot be stored unless explicitly sold as a pass.

Do not silently delete purchased products. If expiry is introduced later, the expiration time must be visible before purchase and is outside the first implementation.

---

## 9. Crisis Focus Mode

### 9.1. Core rule

When one need reaches zero, that need becomes the family's active crisis.

While a crisis is active:

- the player may open and inspect every business;
- the player may buy or use only products and services that restore the active crisis need;
- unrelated need recovery is disabled;
- the other needs continue to decrease;
- the blocked action displays a clear reason;
- ownership, house editing, wallet access, and general account access remain available.

Example:

> Hunger is at zero. The family cannot focus on reading. Restore Hunger above 20 to use the library.

This directly implements the intended logic: while the family is starving, buying a book cannot restore Knowledge, so Knowledge continues to fall.

### 9.2. Recovery threshold

A crisis does not end at `0.1`.

Use:

```text
CRISIS_EXIT_THRESHOLD = 20
```

The active crisis remains until its need reaches at least 20.

This prevents a player from buying the smallest possible item to unlock every other business immediately.

### 9.3. Other needs during a crisis

While one need is zero:

- the remaining needs keep their normal decay;
- they do not receive passive recovery;
- purchases for them cannot be completed;
- secondary effects that would restore them are suspended.

Example:

A restaurant meal normally restores Hunger and Family Bond. If Hunger is the active crisis, the meal restores Hunger only. Its Family Bond bonus is not applied during the crisis.

The product confirmation must clearly show this before purchase.

### 9.4. Crisis behavior by need

#### Hunger crisis

Allowed recovery businesses:

- Grocery Store;
- Bakery;
- Restaurant food offers.

Blocked recovery categories:

- books and library sessions;
- flowers and entertainment;
- energy-only services.

#### Energy crisis

Allowed recovery businesses:

- Café energy offers;
- Rest Center;
- Hotel or Spa service if enabled.

Blocked recovery categories:

- library and books;
- flowers and entertainment;
- food that has no Energy effect.

#### Knowledge crisis

Allowed recovery businesses:

- Library;
- Bookstore;
- education service.

Blocked recovery categories:

- unrelated food;
- unrelated energy services;
- flowers and entertainment.

#### Family Bond crisis

Allowed recovery businesses:

- Flower Shop;
- Family Entertainment;
- eligible family-service offers.

Blocked recovery categories:

- unrelated books;
- individual food purchases;
- individual energy purchases.

### 9.5. Several needs at zero

Use a deterministic crisis priority:

```text
1. Hunger
2. Energy
3. Knowledge
4. Family Bond
```

Only the highest-priority zero need is active.

Example:

1. Hunger and Knowledge are both zero.
2. Hunger becomes active.
3. The player buys food until Hunger is at least 20.
4. Knowledge becomes active.
5. The player buys or uses a book or library service until Knowledge is at least 20.
6. Normal purchasing resumes when no need remains at zero.

### 9.6. Complete crisis

If all four needs reach zero:

- the family enters `Full Household Crisis`;
- no resident is removed;
- the house and business remain owned;
- the family's needs must be restored in priority order;
- the interface shows a four-step recovery list;
- only the currently required business category is highlighted;
- completing one step unlocks the next one.

Required order:

```text
Food → Energy → Knowledge → Family Bond
```

### 9.7. Availability safety valve

A strict crisis lock is dangerous if no player-owned business has the required stock. The player must never become permanently blocked because another player closed a shop.

Use a city-operated emergency offer only when:

- the required player-business category has no valid offer;
- all relevant player businesses are out of stock or unavailable;
- the unavailable state has persisted for a configured grace period.

Emergency offer rules:

- it is paid with Game Coins;
- it restores only enough to reach the crisis exit threshold;
- it costs at least 25% more than the current regional player-business reference price;
- it gives no bonus effect;
- it is hidden as soon as a valid player offer becomes available;
- it cannot be resold;
- it is not used for ordinary non-crisis shopping.

This is a last-resort anti-softlock mechanism, not a competing normal business.

---

## 10. Business Types

The initial economy must include businesses with clear need-related roles.

### 10.1. Grocery Store

Primary need: Hunger.

Products:

- Grocery Basket;
- Large Family Basket;
- Extended Family Basket;
- basic prepared food.

Characteristics:

- strongest storage-oriented food option;
- suitable for advance purchases;
- no Energy, Knowledge, or Family Bond bonus;
- must have limited stock.

### 10.2. Bakery

Primary need: Hunger.

Products:

- bread;
- pastry box;
- family breakfast;
- bakery meal.

Characteristics:

- smaller and cheaper recovery than a restaurant;
- faster stock turnover;
- limited stock;
- encourages frequent neighborhood purchases.

### 10.3. Restaurant

Primary need: Hunger.

Secondary need: Family Bond outside Crisis Focus Mode.

Services:

- family lunch;
- family dinner;
- large-family table.

Characteristics:

- higher price;
- stronger Hunger recovery;
- optional Family Bond bonus in normal state;
- consumes service capacity;
- cannot apply the secondary effect when Hunger is the active crisis.

### 10.4. Café

Primary need: Energy.

Secondary need: Family Bond outside Crisis Focus Mode.

Products and services:

- coffee;
- tea;
- family café visit;
- large-family café table.

Characteristics:

- fast Energy recovery;
- small social bonus during normal play;
- limited product stock or service capacity;
- does not replace a full Hunger business.

### 10.5. Rest Center

Primary need: Energy.

Possible visual themes:

- small hotel;
- spa;
- quiet lounge;
- recovery center.

Characteristics:

- strongest Energy recovery;
- service-capacity based;
- more expensive than coffee;
- suitable for large families through grouped service packages.

### 10.6. Library and Bookstore

Primary need: Knowledge.

The project may use one combined building or two visual variants.

Products and services:

- book;
- family reading session;
- research session;
- large-family library pass.

Characteristics:

- a book is an inventory item and must be used;
- a library session applies after completion;
- books must have limited household storage;
- repeatedly buying the exact same book must not apply unlimited recovery unless it is defined as a reusable service.

### 10.7. Flower Shop

Primary need: Family Bond.

Products:

- small bouquet;
- family bouquet;
- celebration arrangement.

Characteristics:

- buying flowers does not immediately restore Family Bond;
- the player must use the bouquet as a gift inside the family;
- one bouquet cannot be used repeatedly;
- flower storage is limited.

### 10.8. Family Entertainment

Primary need: Family Bond.

Possible visual themes:

- cinema;
- game room;
- family activity center;
- small park pavilion.

Characteristics:

- strongest Family Bond recovery;
- requires service capacity;
- offers packages based on family size;
- cannot be completed if another need is currently in crisis.

---

## 11. Business Availability and Player Motivation

### 11.1. Player businesses must be preferred

When displaying a need-recovery recommendation, rank player-owned businesses before any system fallback.

Rank offers using:

```text
needRecovery
price
familyCoverage
distance
stockAvailability
businessReputation
serviceAvailability
playerPreference
```

Do not select a random business.

### 11.2. Recommended-business interface

When a need reaches 30, show:

- the need that is becoming low;
- estimated time until zero;
- three suitable player businesses;
- price;
- recovery amount;
- family coverage;
- distance;
- stock state.

When a need reaches 10, visually prioritize the recovery button without blocking other actions yet.

When a need reaches zero, highlight only businesses valid for the active crisis.

### 11.3. Motivation without artificial rewards

The main motivation to buy is:

- preventing crisis restrictions;
- keeping all business categories available;
- keeping the family visually active;
- accessing combined services and bonuses;
- saving time through stronger products;
- supporting a preferred neighboring business;
- maintaining a predictable family routine.

Do not create withdrawable Game Coins as a reward for satisfying needs.

### 11.4. Business stock and capacity

Every business must use one of:

- finite product stock;
- finite service capacity.

A business with zero stock or capacity cannot complete a sale.

The owner must see:

- current stock;
- service capacity;
- active offers;
- recent demand;
- which family sizes the offers support.

### 11.5. Family packages

Every core business must support at least:

- package for up to 4 residents;
- package for up to 8 residents;
- package for up to 12 residents.

Larger packages consume proportionally more stock or capacity. They may include a small bulk discount.

---

## 12. Browser Purchase Flow

The player does not manually control a resident walking through an interior.

Required flow:

1. Player clicks a business in the world.
2. The business card opens.
3. The UI displays valid products and services.
4. Incompatible offers explain why they are unavailable.
5. The player selects an offer.
6. The UI previews:
   - current need;
   - resulting need;
   - family coverage;
   - price;
   - stock or capacity;
   - any suspended secondary effect;
   - crisis-lock consequences.
7. Player confirms the purchase.
8. The existing purchase system completes the transaction.
9. The backend applies the product or starts the service.
10. The household need is updated.
11. The private household channel receives the new state.
12. The business stock or capacity display updates for relevant players.

### 12.1. Invalid purchase examples

Use precise messages:

- “The family is hungry. Books cannot be used until Hunger reaches 20.”
- “This package serves four residents, but your family has eight.”
- “This café has no service capacity left.”
- “Family Entertainment is unavailable during an Energy crisis.”
- “Your household already stores the maximum number of books.”
- “This offer became unavailable. Refresh the business list.”

---

## 13. Floor Selection During House Construction

### 13.1. Remove the current two-story choice

Remove “Two-story house” from the current house-type or house-style selection.

House type must define:

- footprint;
- architectural style;
- base room layout;
- compatible materials;
- compatible roof family.

It must not define the final floor count.

### 13.2. Add a dedicated floor-count step

Add a separate construction step after house type or foundation selection.

Required interface:

```text
Number of floors

       [ − ]   1   [ + ]

Residents: 4
Maximum floors: 5
```

Rules:

- minimum value: 1;
- maximum value: 5;
- default value: 1;
- `−` is disabled at 1;
- `+` is disabled at 5;
- keyboard and touch input must work;
- the selected number is clearly readable;
- the 3D preview updates immediately;
- resident count updates immediately;
- construction cost and required rooms update immediately;
- changing floor count does not randomly regenerate the foundation.

### 13.3. Preview information

For every selected floor count, show:

- total floors;
- total residents;
- total price;
- expected construction time;
- available interior area;
- required bedroom capacity;
- number of editable floor tabs.

Example:

```text
Floors: 3
Family residents: 8
Family consumption units: 2
Editable interiors: Ground Floor, Floor 2, Floor 3
```

### 13.4. Model generation

The system must build the selected style from modular floor-compatible parts:

- foundation;
- ground-floor shell;
- repeatable or variant upper-floor shells;
- windows and wall modules;
- floor slabs;
- stairs;
- top-floor ceiling;
- compatible roof.

Do not maintain five unrelated complete house models if one modular system can produce the supported variants reliably.

All selected floor counts must pass collision, stair, roof, window, and interior validation.

---

## 14. Adding Floors Later

Every completed house with fewer than five floors must provide an `Add Floor` action.

### 14.1. Extension flow

1. Player opens the house-management interface.
2. Player selects `Add Floor`.
3. The game shows the next floor, cost, construction time, room template, and `+2 residents` result.
4. Player confirms using the existing payment system.
5. The roof is removed or transitioned as part of the construction animation.
6. The new structural floor is built.
7. Stairs and the floor opening are added or extended.
8. A new editable interior is created.
9. The roof is moved to the new top floor.
10. Two residents are added after successful completion.
11. All connected clients see the updated building.

### 14.2. Extension rules

- add one floor per extension operation;
- never exceed five floors;
- existing lower floors remain editable;
- lower-floor furniture must not move randomly;
- the new staircase must not overlap existing furniture;
- if the required stair zone is blocked, the player must resolve it before confirming;
- the roof must exist only on the highest floor;
- no duplicate residents may be created after reconnection or event replay;
- construction failure must not leave the house without a valid roof or floor record.

### 14.3. Resident addition

After a new floor is complete:

- create exactly two additional family residents;
- assign them valid sleeping slots on the new floor;
- include them in family animations and service-size calculations;
- do not create separate Family Bond bars;
- do not create a separate household.

---

## 15. Multi-Floor Interior Editing

Every floor must have a dedicated interior-editing state.

### 15.1. Floor selector

Required UI example:

```text
[ Ground ] [ 2 ] [ 3 ] [ 4 ] [ 5 ]
```

Show only floors that exist.

The selected floor must be visually obvious.

### 15.2. Visibility modes

Support:

- active floor only;
- active floor with a transparent floor below;
- full-building preview;
- cutaway mode that hides floors above the active floor;
- roof hidden while editing the top floor.

Only the active floor receives placement input.

### 15.3. Equal functionality

Every floor, including Floor 2 through Floor 5, must support:

- viewing available placement slots;
- placing furniture;
- replacing furniture;
- removing furniture;
- rotating an item when the slot permits it;
- editing wall decorations;
- editing floor and wall finishes where supported;
- saving;
- loading;
- validation.

Upper floors must not be decorative non-editable shells.

---

## 16. Remove Random Interior Placement

### 16.1. Prohibited behavior

Do not use:

- random coordinates;
- random slot selection;
- random rotation;
- nearest unvalidated point;
- mesh-center guesses;
- physics settling as final placement;
- one shared list of spots for every floor;
- wall placement for floor furniture.

Furniture must reconstruct in the same position after every reload and on every connected client.

### 16.2. Strict authored slots

Each floor-layout template must contain deliberate semantic slots.

Required slot data:

```text
slotId
floorId
roomId
slotType
allowedItemCategories
position
rotation
maximumWidth
maximumDepth
maximumHeight
clearanceBounds
interactionPoint
navigationClearance
wallIdIfRequired
parentSlotIdIfRequired
occupancyState
```

Required slot types:

- `FloorLarge`;
- `FloorMedium`;
- `FloorSmall`;
- `WallDecoration`;
- `WallShelf`;
- `CeilingLight`;
- `Tabletop`;
- `Bed`;
- `Seating`;
- `Storage`;
- `StairReserved`;
- `DoorClearance`;
- `WindowClearance`.

Reserved clearance slots cannot receive furniture.

### 16.3. Room-specific slot examples

#### Bedroom

- bed slots against valid walls;
- bedside-table slots beside beds;
- wardrobe slot away from door swing;
- wall-decoration slots above permitted surfaces;
- clear path from door to bed.

#### Living room

- sofa slots on the floor;
- chair slots;
- table slot;
- television or wall-decoration slot;
- clear central walking route.

#### Kitchen

- counter slots;
- table slot;
- chair child-slots;
- appliance slots;
- no furniture inside door or stair clearance.

#### Upper-floor family bedroom

- two valid sleeping places for the two residents added by that floor;
- storage slots;
- lighting slot;
- valid access from stairs;
- no object intersection with the floor opening.

### 16.4. Item compatibility

Every furniture definition must declare:

```text
itemId
category
supportedSlotTypes
width
depth
height
pivotType
allowedRotations
collisionBounds
interactionBounds
modelId
```

An item is shown as compatible only when:

- its category is allowed by the slot;
- its dimensions fit;
- its pivot is valid;
- its rotation is supported;
- it does not intersect another item;
- it does not block navigation;
- it belongs to the active floor.

### 16.5. Placement behavior

When the player selects furniture:

1. highlight compatible empty slots;
2. hide or dim incompatible slots;
3. let the player select a highlighted slot;
4. snap the item to the slot's defined position and rotation;
5. validate size, collision, navigation, and interaction access;
6. show the final preview;
7. save the exact `floorId`, `roomId`, `slotId`, and `itemId`.

Do not generate a new position after purchase or reload.

### 16.6. Floor furniture versus wall furniture

Floor objects such as:

- beds;
- sofas;
- tables;
- chairs;
- cabinets;
- lamps with floor bases;

must never be assigned to a wall slot.

Wall slots accept only explicitly compatible objects such as:

- paintings;
- posters;
- wall shelves;
- wall lamps;
- mirrors.

Ceiling slots accept only ceiling-compatible objects.

---

## 17. Permission to Replace Interior Models

The implementation agent may resize, repivot, remap, modify, or completely replace interior models when they do not fit the new slot standard.

Model replacement is required when:

- a floor object has a wall-oriented pivot;
- the model dimensions are incorrect;
- the model contains extreme empty bounds;
- collision does not match the visible object;
- the item cannot fit any reasonable room slot;
- furniture intersects walls when snapped correctly;
- scale differs from residents and doors;
- the model has duplicate or broken geometry.

The new model must:

- match the game's visual style;
- use predictable dimensions;
- use a correct bottom-center pivot for floor furniture;
- use a rear attachment pivot for wall objects;
- include valid collision bounds;
- include an interaction point where needed;
- pass first-floor and upper-floor placement tests.

Visual compatibility with the old model is not required. Correct gameplay placement is more important.

### 17.1. Existing random placements

Old random positions do not need to be preserved.

During migration:

- clear invalid old placement coordinates;
- generate the new authored slots;
- keep the player's item ownership when it is available in current data;
- return previously placed items to the house inventory;
- require the player to place them into valid slots;
- never copy first-floor positions to upper floors.

---

## 18. House Layout Standard by Floor

### 18.1. Ground floor

The ground floor is the shared family level.

It should normally contain:

- entrance;
- living room;
- kitchen or dining area;
- bathroom;
- staircase when the house has more than one floor;
- optional bedroom or office depending on template.

### 18.2. Every additional floor

Each upper floor adds capacity for two residents and must contain:

- at least one valid two-person sleeping area or two one-person sleeping areas;
- valid stair arrival and departure space;
- a clear navigation route;
- interior placement slots;
- windows appropriate to the selected house style;
- optional bathroom, office, storage, or family space according to the layout.

The implementation may provide two or three upper-floor layout variants. Keep the initial selection small.

### 18.3. Five-floor house

A five-floor house remains one extended family house.

It must not behave as:

- five unrelated apartments;
- five independent businesses;
- five independent families;
- five separate need systems.

It has:

- 12 residents;
- one set of four household needs;
- three family consumption units;
- one Family Bond value;
- one owner account;
- separately editable interiors on all five floors.

---

## 19. Existing House Migration

### 19.1. Current one-floor houses

- set `floorCount = 1`;
- set resident count to 4;
- generate the correct ground-floor slot template;
- move old interior items to house inventory when ownership data exists.

### 19.2. Current two-story houses

- remove the old two-story catalog entry;
- convert the building to its corresponding base house type;
- set `floorCount = 2`;
- set resident count to 6;
- create editable records for both floors;
- create independent slot templates for both floors;
- ensure the second floor can be selected and furnished;
- move invalid old furniture placements to house inventory.

### 19.3. Migration validation

After migration, verify:

- correct floor count;
- correct resident count;
- roof on the highest floor only;
- valid stairs;
- editable upper floor;
- no floor furniture attached to walls;
- no duplicate residents;
- deterministic furniture placement;
- identical reconstruction after reload.

---

## 20. Networking and State Synchronization

Use the existing real-time construction behavior for houses and businesses.

### 20.1. Public events

Broadcast to relevant connected players:

- house construction started;
- floor added;
- construction progress milestone;
- construction completed;
- business availability changed;
- business stock availability changed when relevant to the visible area.

### 20.2. Private household events

Send only to the household owner:

- need threshold crossed;
- crisis started;
- active crisis changed;
- product used;
- service completed;
- crisis ended;
- resident count changed;
- floor interior saved.

Do not broadcast private need values to the entire world.

### 20.3. State safety

Every state-changing event requires:

- stable event ID;
- household or house ID;
- state revision;
- server timestamp;
- resulting canonical state.

Repeated or out-of-order messages must not:

- add residents twice;
- restore a need twice;
- occupy one furniture slot twice;
- create duplicate floors;
- move furniture to another floor.

WebSocket delivery does not replace authoritative server state.

---

## 21. Interface Requirements

### 21.1. Family panel

Display:

- four need bars;
- current resident count;
- floor count;
- time estimate until the next need reaches zero;
- active crisis if present;
- recommended businesses;
- family consumption units.

### 21.2. Warnings

At need value 30:

- show a soft warning;
- show recommended businesses.

At value 10:

- show a critical warning;
- show the exact estimated time until zero.

At value 0:

- open Crisis Focus Mode;
- explain which purchases are currently allowed;
- explain the exit threshold;
- show available player businesses first.

### 21.3. Floor construction screen

Display:

- `[−] floorCount [+]`;
- preview model;
- residents after construction;
- family consumption units;
- cost;
- construction time;
- floor-specific room preview.

### 21.4. Interior screen

Display:

- active floor tabs;
- room name;
- strict placement slots;
- compatible item list;
- occupied and free slots;
- reason an item cannot be placed;
- save status.

---

## 22. Analytics Required for Balancing

Record anonymized gameplay events for:

- active session length;
- time taken for each need to reach 30, 10, and 0;
- number of crisis states per active household;
- duration of crisis states;
- purchases per need category;
- purchase frequency by family size;
- percentage of sales completed by player businesses;
- emergency city-offer activations;
- unavailable-stock incidents;
- most frequently selected businesses;
- unused business categories;
- product storage saturation;
- floor-count distribution;
- later floor additions;
- furniture-slot placement failures.

Initial balancing targets:

- the fastest need should take approximately eight active hours to move from 100 to 0 without recovery;
- needs should not normally reach zero during a short first session;
- player businesses should complete the clear majority of recovery purchases;
- the emergency city offer should be rare;
- crises should motivate action but should not permanently trap an account;
- larger families should create more demand without making five-floor houses unmanageable.

---

## 23. Test Scenarios

### Needs and businesses

1. Hunger decreases from 100 to 0 in approximately eight active hours.
2. A disconnected household loses only the capped offline amount.
3. Family Bond does not decrease while fully offline.
4. At Hunger 0, a library purchase is blocked.
5. At Hunger 0, a valid Grocery Store purchase is allowed.
6. Hunger must reach 20 before the library becomes usable again.
7. During Hunger crisis, a restaurant's Family Bond bonus is suspended.
8. Other needs continue decreasing during a crisis.
9. Two simultaneous zero needs resolve in the required priority order.
10. All four zero needs produce the complete-crisis recovery sequence.
11. A player-owned valid offer is shown before the emergency city offer.
12. Emergency offer appears only when no player offer is available.
13. A product used twice applies its effect once.
14. A four-person package gives partial recovery to an eight-person family.
15. Storage limits prevent unlimited stockpiling.
16. Flowers restore Family Bond only after being used as a gift.

### Floors and residents

17. The floor selector cannot go below 1 or above 5.
18. A one-floor house creates 4 residents.
19. A two-floor house creates 6 residents.
20. A three-floor house creates 8 residents.
21. A four-floor house creates 10 residents.
22. A five-floor house creates 12 residents.
23. Replayed construction events do not duplicate residents.
24. The old two-story option is absent from house-type selection.
25. Floor count is selected through the separate plus/minus step.
26. The preview updates resident count and cost immediately.
27. A completed one-floor house can add a second floor later.
28. Adding a floor moves the roof to the new top level.
29. Adding a floor creates exactly two residents after completion.
30. No house exceeds five floors.

### Interiors

31. Every existing floor can be selected and edited.
32. Every upper floor has its own authored slots.
33. A sofa cannot occupy a wall slot.
34. A painting cannot occupy a floor slot.
35. An oversized item is not shown as compatible.
36. Furniture cannot occupy door, window, or stair clearance.
37. One slot cannot contain two items.
38. Reloading does not change item position or rotation.
39. Another client reconstructs the same interior.
40. Current random placements migrate to inventory rather than being copied incorrectly.
41. A replaced furniture model uses the correct pivot and collision.

---

## 24. Delivery Phases

### Phase 1: Need state and timing

- implement the four household values;
- implement server-authoritative elapsed-time calculation;
- implement active, background, and offline rates;
- add thresholds, warnings, and configuration.

### Phase 2: Crisis Focus Mode

- implement zero-need locks;
- implement the crisis exit threshold;
- implement multi-zero priority;
- implement suspended secondary effects;
- implement full-crisis interface;
- implement availability safety valve.

### Phase 3: Business catalog and recovery

- implement the required business categories;
- implement product coverage and family packages;
- implement stock and service-capacity compatibility;
- implement business ranking and recommendations;
- connect successful purchases to need effects.

### Phase 4: Floor-count construction step

- remove the two-story catalog choice;
- add the 1–5 plus/minus selector;
- update previews, resident count, rooms, price, and construction time;
- create modular floor and roof generation;
- connect completion to resident creation.

### Phase 5: Later floor extensions

- implement `Add Floor`;
- validate stairs and existing interiors;
- synchronize construction;
- add two residents after successful completion;
- support extension up to five floors.

### Phase 6: Interior replacement

- remove random placement logic;
- create authored slots for every room and floor template;
- add item metadata and compatibility filters;
- replace or modify incompatible models;
- implement deterministic save and load;
- migrate existing interiors.

### Phase 7: Balance and verification

- run every required test scenario;
- collect need and business analytics;
- tune timings and recovery values through configuration;
- verify family sizes from 4 to 12;
- verify all interiors from one to five floors.

---

## 25. Acceptance Criteria

The task is complete only when all of the following are true.

### Needs

1. The family has Hunger, Energy, Knowledge, and Family Bond.
2. Values are authoritative on the backend.
3. Hunger takes approximately eight active hours to fall from 100 to 0.
4. The other needs use distinct, logical timings.
5. Offline decay is reduced and capped.
6. Family Bond does not decay while fully offline.
7. The UI warns at 30 and 10.
8. A zero need activates Crisis Focus Mode.
9. Unrelated recovery purchases are blocked during a crisis.
10. The crisis ends only after the active need reaches 20.
11. Remaining needs continue decreasing during the crisis.
12. Secondary recovery effects are suspended during the crisis.
13. Multiple zero needs use Hunger, Energy, Knowledge, Family Bond priority.
14. All-zero state has a clear sequential recovery interface.
15. No crisis removes residents, houses, businesses, or owned items.

### Player-business demand

16. Grocery Store, Bakery, Restaurant, Café, Rest Center, Library or Bookstore, Flower Shop, and Family Entertainment roles are supported as defined.
17. Every need has at least one corresponding player-business category.
18. Player businesses are recommended before the emergency city option.
19. Business selection is ranked rather than random.
20. Product and service effects are shown before purchase.
21. Products use family-size coverage.
22. Larger families require more stock or capacity for full recovery.
23. Storage limits prevent unlimited preparation.
24. Goods apply effects only when used.
25. Services apply effects only when completed.
26. No need-satisfaction action mints withdrawable Game Coins.

### Floors and residents

27. Every house represents one family.
28. Floor count can be selected from 1 to 5.
29. Floor selection is a dedicated `[−] number [+]` step.
30. The old two-story house option is removed from the current selection.
31. Resident count follows `4 + ((floorCount - 1) × 2)`.
32. Floor and resident previews update before confirmation.
33. Every added floor creates two residents exactly once after completion.
34. A floor can be added later to a completed house.
35. The roof and stairs remain valid after an extension.
36. All construction changes remain visible through the existing real-time system.
37. A five-floor house remains one family with one set of four needs.

### Interiors

38. No interior object uses a random position or rotation.
39. Every floor has its own strict authored slots.
40. Every existing floor can be selected and edited.
41. Item categories and dimensions are validated against slot metadata.
42. Floor furniture cannot appear on walls.
43. Wall objects cannot appear on the floor.
44. Furniture cannot block stairs, doors, windows, navigation, or interaction points.
45. Item position is identical after reload and on another client.
46. Incompatible furniture models have been modified or replaced.
47. Old invalid placements are cleared and owned items are returned to house inventory where ownership data exists.
48. Current two-story houses migrate to editable two-floor houses with six residents.

---

## 26. Definition of Done

The implementation is ready when a player can:

1. choose a house style without choosing a separate two-story model;
2. select from one to five floors using a dedicated plus/minus control;
3. see the resulting family size before construction;
4. build one family containing between four and twelve residents;
5. add another floor later and receive two additional family members;
6. edit the interior of every completed floor;
7. place furniture only into deliberate compatible slots;
8. see no furniture randomly attached to a wall or placed in an invalid location;
9. watch four needs decrease at understandable, configurable rates;
10. receive warnings before a need reaches zero;
11. enter a clear crisis state when one need reaches zero;
12. restore the critical need through an appropriate player business;
13. remain unable to restore unrelated needs until the active crisis is resolved;
14. recover from several zero needs in a deterministic order;
15. use larger family packages when the house contains more residents.

The central gameplay result must be a clear loop:

```text
Build a family house
→ family needs decrease
→ the game recommends relevant player businesses
→ the player purchases an appropriate product or service
→ the family recovers and all activities remain available
→ business owners receive real customer demand
→ additional floors create larger families and more demand
```

The system must be understandable without direct character control, must not use random interior placement, and must never create an unrecoverable gameplay lock merely because a required player business is temporarily unavailable.
