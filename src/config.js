// ── Global game configuration ────────────────────────────────────────────────
// Economy, builder options, companion buildings, link graph and the day cycle
// all live here so they can be tuned without touching game logic.

// Enough for the visible 500 / 1,000 / 2,500 quick-funding options at the
// simulated launch price. Real wallets still use their actual provider balance.
export const TOKEN = { name: 'TCITY', startDemoBalance: 5000000, demoBalanceVersion: 3 };
export const COINS = { name: 'coins', rate: 1 };

export const LEVELS = [
  { level: 1, threshold: 0, title: 'Newcomer' },
  { level: 2, threshold: 800, title: 'Citizen' },
  { level: 3, threshold: 2000, title: 'Validator' },
  { level: 4, threshold: 4000, title: 'Tycoon' },
  { level: 5, threshold: 8000, title: 'Architect' },
];

export function levelFor(converted) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (converted >= l.threshold) cur = l;
  return cur;
}

// ── Builder: 7 steps, 3–4 options each ───────────────────────────────────────

export const FOUNDATIONS = [
  { id: 'compact', name: 'Compact', desc: 'Almost square, snug and tidy', cost: 250, level: 1 },
  { id: 'wide',    name: 'Wide',    desc: 'Long front, room for big windows', cost: 400, level: 1 },
  { id: 'lshape',  name: 'Corner',  desc: 'L-shape with a small courtyard', cost: 550, level: 2 },
];

export const HEIGHTS = [
  { id: 'one', name: 'Family House', desc: 'Choose the number of floors in the next step', cost: 0, level: 1 },
];

export const MAX_FLOORS = 5;
export const ADDITIONAL_FLOOR_COST = 450;

/** Accept legacy buildings at the boundary; all newly saved houses use floorCount. */
export function floorCountFor(value = 1) {
  const raw = typeof value === 'object' && value !== null
    ? value.floorCount ?? ((value.height === 'two' || value.height === 'attic') ? 2 : 1)
    : value;
  return Math.max(1, Math.min(MAX_FLOORS, Math.trunc(Number(raw) || 1)));
}

export function familyConsumptionFor(value = 1) {
  return Math.ceil(residentsFor(value) / 4);
}

export function constructionSecondsFor(value = 1) {
  return 4 + (floorCountFor(value) - 1) * 2;
}

export function floorExtensionCost(cfg) {
  return floorCountFor(cfg) < MAX_FLOORS ? ADDITIONAL_FLOOR_COST : 0;
}

// A layout is structural data, not a visual preset. Every supported
// foundation exposes the same deliberately small initial set (task5 §6).
// The ratios are consumed by houseModel.js and therefore reconstruct
// identically on every client.
export const HOUSE_LAYOUTS = [
  {
    id: 'balanced',
    name: 'Balanced',
    desc: 'Even rooms with a simple central connection',
    cost: 0,
    level: 1,
    splitRatio: 0.52,
  },
  {
    id: 'social',
    name: 'Social',
    desc: 'A larger living area for gatherings',
    cost: 80,
    level: 1,
    splitRatio: 0.62,
  },
  {
    id: 'private',
    name: 'Private',
    desc: 'More space for bedrooms and focused rooms',
    cost: 100,
    level: 1,
    splitRatio: 0.43,
  },
];

// Each material ships three ready-made color schemes (light / warm / dark-accent;
// tech swaps warm for a cold neon scheme). No free color picking.
export const MATERIALS = [
  {
    id: 'wood', name: 'Wood', desc: 'Warm timber panels', cost: 0, level: 1,
    schemes: [
      { id: 'light', name: 'Light',  wall: '#e8d5b0', trim: '#b08d5e', roof: '#a06a4a', accent: '#7a9e5f' },
      { id: 'warm',  name: 'Warm',   wall: '#c89a68', trim: '#8a6f4d', roof: '#7d5a3c', accent: '#d96c5f' },
      { id: 'dark',  name: 'Dusk',   wall: '#8a6f52', trim: '#5d4a35', roof: '#4a3a2a', accent: '#ffd166' },
    ],
  },
  {
    id: 'brick', name: 'Brick', desc: 'Stylized brick blocks', cost: 120, level: 1,
    schemes: [
      { id: 'light', name: 'Light',  wall: '#d9a08a', trim: '#f0e6d5', roof: '#6d5a50', accent: '#5f7a9e' },
      { id: 'warm',  name: 'Warm',   wall: '#b5654a', trim: '#e0cfae', roof: '#54423a', accent: '#e0a03a' },
      { id: 'dark',  name: 'Dusk',   wall: '#8a4a3a', trim: '#c9b89a', roof: '#3a2f2a', accent: '#4ecdc4' },
    ],
  },
  {
    id: 'stone', name: 'Light Stone', desc: 'Soft pale stone blocks', cost: 200, level: 2,
    schemes: [
      { id: 'light', name: 'Light',  wall: '#e8e2d2', trim: '#c9c2ae', roof: '#b0a894', accent: '#7aa2f7' },
      { id: 'warm',  name: 'Sand',   wall: '#d9c9a3', trim: '#b5a37e', roof: '#8a7d64', accent: '#d96c5f' },
      { id: 'dark',  name: 'Slate',  wall: '#b5b0a3', trim: '#8a857a', roof: '#5d5952', accent: '#ffd166' },
    ],
  },
  {
    id: 'tech', name: 'Tech Panels', desc: 'Dark panels, glowing lines', cost: 350, level: 3,
    schemes: [
      { id: 'light', name: 'Silver', wall: '#b8c2cf', trim: '#748297', roof: '#65738a', accent: '#2ec4b6' },
      { id: 'cold',  name: 'Neon',   wall: '#596b82', trim: '#46556c', roof: '#43506a', accent: '#59f2ff' },
      { id: 'dark',  name: 'Violet', wall: '#62547f', trim: '#4b4164', roof: '#463b62', accent: '#d7a8ff' },
    ],
  },
];

export const ROOFS = [
  { id: 'gable', name: 'Gable', desc: 'Classic pitched silhouette', cost: 0,   level: 1 },
  { id: 'shed',  name: 'Shed',  desc: 'Modern single slope', cost: 100, level: 1 },
  { id: 'flat',  name: 'Flat',  desc: 'Parapet terrace on top', cost: 150, level: 1 },
];

export const KITS = [
  { id: 'cozy', name: 'Cozy Set',  desc: 'Homely windows, small porch', cost: 0,   level: 1 },
  { id: 'open', name: 'Open Set',  desc: 'Big windows, wide entrance', cost: 150, level: 1 },
  { id: 'tech', name: 'Tech Set',  desc: 'Tall slim windows, lit doorway', cost: 250, level: 2 },
];

export const DETAILS = [
  { id: 'solar',   name: 'Solar Panels', desc: 'Needs a flat or shed roof', cost: 200, level: 1 },
  { id: 'antenna', name: 'Antenna',      desc: 'Small mast with a beacon', cost: 150, level: 1 },
  { id: 'balcony', name: 'Balcony',      desc: 'Needs more than one floor', cost: 250, level: 2 },
  { id: 'token',   name: 'Token Sign',   desc: 'Spinning golden coin', cost: 350, level: 3 },
];

/** Combination rules (spec §10): a detail can be unavailable for some homes. */
export function detailAllowed(detail, cfg) {
  if (detail === 'solar') return cfg.roof !== 'gable';
  if (detail === 'balcony') return floorCountFor(cfg) > 1;
  return true;
}

// ── Companion buildings (spec §12): two offers per material ─────────────────
export const COMPANIONS = {
  wood:  [
    { id: 'cafe',      name: 'Little Café',   sign: 'CAFÉ' },
    { id: 'flower',    name: 'Flower Shop',   sign: 'FLOWERS' },
  ],
  brick: [
    { id: 'bakery',    name: 'Bakery',        sign: 'BAKERY' },
    { id: 'workshop',  name: 'Workshop',      sign: 'WORKSHOP' },
  ],
  stone: [
    { id: 'library',   name: 'Library',       sign: 'LIBRARY' },
    { id: 'gallery',   name: 'Gallery',       sign: 'GALLERY' },
  ],
  tech:  [
    { id: 'techstore', name: 'Tech Store',    sign: 'TECH' },
    { id: 'arcade',    name: 'Game Arcade',   sign: 'ARCADE' },
  ],
};

export function companionName(id) {
  for (const list of Object.values(COMPANIONS)) {
    const c = list.find((x) => x.id === id);
    if (c) return c.name;
  }
  return '—';
}

/** Complementary pairs → functional links (bakery↔café, library↔gallery…). */
export const FUNC_PAIRS = {
  cafe: ['bakery', 'flower'],
  bakery: ['cafe', 'workshop'],
  flower: ['cafe', 'gallery'],
  workshop: ['bakery', 'techstore'],
  library: ['gallery'],
  gallery: ['library', 'flower'],
  techstore: ['arcade', 'workshop'],
  arcade: ['techstore'],
};

// ── Link graph (spec §15) ────────────────────────────────────────────────────
export const LINK_TYPES = {
  architectural: { name: 'Architecture', color: '#ffd166' },
  district:      { name: 'District',     color: '#4ecdc4' },
  functional:    { name: 'Function',     color: '#c792ea' },
  social:        { name: 'Social',       color: '#ff8a71' },
};
export const MAX_LINKS = 5; // 3–5 visible links per house

// ── Day / night cycle (spec §17) ─────────────────────────────────────────────
export const DAY = {
  cycleMinutes: 30,  // slow enough that cast shadows do not visibly race
  startPhase: 0.38,  // first visit lands in a warm, readable late afternoon
};

// ── Content collections (task3 §3) ───────────────────────────────────────────
// A weekly collection stays obtainable for its date range; afterwards it is
// archived: installed copies remain, new purchases stop, the label keeps the
// dates (Meme History Archive).
export const COLLECTIONS = {
  meme_reserve: {
    name: 'Meme Reserve Week',
    from: '2026-08-03',
    to: '2026-08-10',
    desc: 'Parody of pseudo-official funds, oil narratives and very serious acronyms',
  },
};

export function collectionState(id) {
  const c = COLLECTIONS[id];
  if (!c) return null;
  const now = Date.now();
  const from = new Date(c.from + 'T00:00:00').getTime();
  const to = new Date(c.to + 'T23:59:59').getTime();
  return { ...c, active: now >= from && now <= to, upcoming: now < from };
}

// ── Item catalog (task3 §4–6) ────────────────────────────────────────────────
// slots: floor-large | floor-med | floor-small | floor-tall | wall | surface |
//        window | door | yard   (yard = outdoor sockets on the plot)
// set: thematic material set the item belongs to (recommendation only).
export const ITEMS = [
  // базовая мебель
  { id: 'bed_double', name: 'Family Double Bed', cost: 160, rarity: 'common', slots: ['bed'], level: 1 },
  { id: 'family_bunk', name: 'Family Bunk Bed', cost: 140, rarity: 'common', slots: ['bed'], level: 1 },
  { id: 'chair', name: 'Dining Chair', cost: 45, rarity: 'common', slots: ['seating'], level: 1 },
  { id: 'wardrobe', name: 'Family Wardrobe', cost: 130, rarity: 'common', slots: ['storage'], level: 1 },
  { id: 'pendant_light', name: 'Pendant Light', cost: 65, rarity: 'common', slots: ['ceiling'], level: 1 },
  { id: 'wall_shelf', name: 'Wall Shelf', cost: 50, rarity: 'common', slots: ['wall-shelf'], level: 1 },
  { id: 'kitchen_counter', name: 'Kitchen Counter', cost: 110, rarity: 'common', slots: ['floor-med'], level: 1 },
  { id: 'fridge', name: 'Family Fridge', cost: 150, rarity: 'common', slots: ['storage'], level: 1 },
  { id: 'rug',        name: 'Rug',              cost: 60,  rarity: 'common', slots: ['floor-large'], level: 1 },
  { id: 'sofa',       name: 'Sofa',             cost: 180, rarity: 'common', slots: ['floor-large'], level: 1 },
  { id: 'table',      name: 'Coffee Table',     cost: 90,  rarity: 'common', slots: ['floor-med'],   level: 1 },
  { id: 'plant',      name: 'House Plant',      cost: 50,  rarity: 'common', slots: ['floor-small'], level: 1 },
  { id: 'lamp_floor', name: 'Floor Lamp',       cost: 80,  rarity: 'common', slots: ['floor-small'], level: 1 },
  { id: 'meme_poster',name: 'Meme Poster',      cost: 70,  rarity: 'common', slots: ['wall'],        level: 1 },
  { id: 'nft_frame',  name: 'NFT Frame',        cost: 150, rarity: 'rare',   slots: ['wall'],        level: 2 },
  { id: 'safe',       name: 'Crypto Safe',      cost: 220, rarity: 'rare',   slots: ['floor-small'], level: 2 },
  { id: 'hw_wallet',  name: 'Hardware Wallet',  cost: 120, rarity: 'rare',   slots: ['surface'],     level: 2, set: 'tech' },
  { id: 'terminal',   name: 'Chart Terminal',   cost: 260, rarity: 'rare',   slots: ['floor-med'],   level: 2, set: 'tech' },
  { id: 'server_rack',name: 'Dev Is Cooking Rack', cost: 350, rarity: 'epic', slots: ['floor-tall'], level: 3, set: 'tech' },
  { id: 'holo_token', name: 'Holo Token',       cost: 500, rarity: 'epic',   slots: ['surface'],     level: 3, set: 'tech' },
  // постоянная крипто-культура (§4.1)
  { id: 'gm_clock',      name: 'GM Clock',            cost: 90,  rarity: 'common', slots: ['surface'],     level: 1 },
  { id: 'gn_moon',       name: 'GN Moon Lamp',        cost: 110, rarity: 'common', slots: ['surface', 'floor-small'], level: 1 },
  { id: 'diamond_hands', name: 'Diamond Hands Trophy', cost: 240, rarity: 'rare',  slots: ['surface'],     level: 2 },
  { id: 'paper_bin',     name: 'Paper Hands Bin',     cost: 80,  rarity: 'common', slots: ['floor-small', 'door'], level: 1 },
  { id: 'bag_rack',      name: 'Bagholder Rack',      cost: 160, rarity: 'common', slots: ['floor-tall', 'door'], level: 1 },
  { id: 'copium_tank',   name: 'Copium Tank',         cost: 200, rarity: 'rare',   slots: ['floor-small'], level: 1, set: 'wood' },
  { id: 'hopium_balloon',name: 'Hopium Balloon',      cost: 120, rarity: 'common', slots: ['floor-small'], level: 1 },
  { id: 'ath_mountain',  name: 'ATH Mountain',        cost: 180, rarity: 'rare',   slots: ['surface'],     level: 1 },
  { id: 'rug_trap',      name: 'Rug Trap',            cost: 260, rarity: 'rare',   slots: ['floor-large'], level: 2 },
  { id: 'green_candle',  name: 'Green Candle Lamp',   cost: 150, rarity: 'common', slots: ['floor-small'], level: 1 },
  { id: 'red_alarm',     name: 'Red Candle Alarm',    cost: 140, rarity: 'common', slots: ['wall'],        level: 1 },
  { id: 'telescope',     name: 'Wen Moon Telescope',  cost: 300, rarity: 'rare',   slots: ['floor-med'],   level: 2 },
  { id: 'grass_mat',     name: 'Touch Grass Mat',     cost: 70,  rarity: 'common', slots: ['floor-small', 'door'], level: 1 },
  { id: 'alpha_folder',  name: 'Alpha Folder',        cost: 130, rarity: 'rare',   slots: ['surface'],     level: 1 },
  { id: 'dyor_shelf',    name: 'DYOR Bookshelf',      cost: 280, rarity: 'rare',   slots: ['floor-tall'],  level: 1 },
  { id: 'vibes_terminal',name: 'Vibes Terminal',      cost: 320, rarity: 'rare',   slots: ['floor-med'],   level: 2, set: 'tech' },
  { id: 'degen_coffee',  name: 'Degen Coffee Machine', cost: 190, rarity: 'common', slots: ['surface'],    level: 1, set: 'wood' },
  { id: 'sell_button',   name: 'Emergency Sell Button', cost: 250, rarity: 'rare', slots: ['surface'],     level: 2 },
  { id: 'doormat',       name: 'Trenches Doormat',    cost: 90,  rarity: 'common', slots: ['door'],        level: 1, set: 'wood' },
  { id: 'candle_arcade', name: 'Chase the Candle Arcade', cost: 450, rarity: 'epic', slots: ['floor-tall'], level: 3 },
  // недельная коллекция: Meme Reserve Week (§5)
  { id: 'oil_barrel',    name: 'Official Unofficial Oil Barrel', cost: 220, rarity: 'weekly', slots: ['floor-small', 'yard'], level: 1, collection: 'meme_reserve', set: 'stone' },
  { id: 'reserve_safe',  name: 'Strategic Meme Reserve Safe',    cost: 340, rarity: 'weekly', slots: ['floor-tall'],  level: 2, collection: 'meme_reserve', set: 'stone' },
  { id: 'ticker_gen',    name: 'Four-Letter Ticker Generator',   cost: 300, rarity: 'weekly', slots: ['floor-med'],   level: 1, collection: 'meme_reserve' },
  { id: 'nothing_cert',  name: 'Tokenized Nothing Certificate',  cost: 180, rarity: 'weekly', slots: ['wall'],        level: 1, collection: 'meme_reserve' },
  { id: 'official_stamp',name: 'Definitely Official Stamp',      cost: 160, rarity: 'weekly', slots: ['surface'],     level: 1, collection: 'meme_reserve' },
  { id: 'copycat_printer', name: 'Copycat Printer',              cost: 280, rarity: 'weekly', slots: ['floor-med'],   level: 2, collection: 'meme_reserve', set: 'brick' },
  { id: 'bull_bust',     name: 'Bull Market Bust',               cost: 260, rarity: 'weekly', slots: ['surface'],     level: 1, collection: 'meme_reserve', set: 'stone' },
  { id: 'asset_board',   name: 'Global Asset Planning Board',    cost: 200, rarity: 'weekly', slots: ['wall'],        level: 1, collection: 'meme_reserve' },
  // поп-культура (§6)
  { id: 'portal',      name: 'Portal to Storage',   cost: 380, rarity: 'epic',  slots: ['floor-tall'],  level: 2 },
  { id: 'brain_lamp',  name: 'Galaxy Brain Lamp',   cost: 170, rarity: 'rare',  slots: ['floor-small'], level: 1 },
  { id: 'ai_printer',  name: 'AI Slop Printer',     cost: 290, rarity: 'rare',  slots: ['floor-med'],   level: 2, set: 'tech' },
  { id: 'ring_light',  name: 'NPC Streamer Ring Light', cost: 150, rarity: 'common', slots: ['floor-small'], level: 1 },
  { id: 'neon_summer', name: '“Summer Was Different” Neon', cost: 210, rarity: 'rare', slots: ['wall'], level: 1 },
  // дворовые предметы (outdoor sockets)
  { id: 'exit_fountain', name: 'Exit Liquidity Fountain', cost: 420, rarity: 'epic',  slots: ['yard'], level: 2 },
  { id: 'dept_flag',     name: 'Meme Department Flag',    cost: 150, rarity: 'common', slots: ['yard'], level: 1, collection: 'meme_reserve' },
  { id: 'touch_patch',   name: 'Touch Grass Patch',       cost: 130, rarity: 'common', slots: ['yard'], level: 1 },
  { id: 'bull_statue',   name: 'Small Bull Statue',       cost: 310, rarity: 'rare',  slots: ['yard'], level: 2, set: 'stone' },
];

export const SETS = {
  wood: 'Cozy Trencher', brick: 'CTO Workshop', stone: 'Strategic Meme Reserve', tech: 'Onchain Operations',
};

export const ROOM_SLOTS = [
  { id: 'center',   type: 'floor-large', name: 'Room Center' },
  { id: 'left',     type: 'floor-large', name: 'Left Wall' },
  { id: 'mid',      type: 'floor-med',   name: 'Lounge Spot' },
  { id: 'right',    type: 'floor-med',   name: 'Right Wall' },
  { id: 'corner_bl',type: 'floor-tall',  name: 'Far Corner' },
  { id: 'corner_br',type: 'floor-small', name: 'Right Corner' },
  { id: 'corner_fr',type: 'floor-small', name: 'Near Corner' },
  { id: 'wall_l',   type: 'wall',        name: 'Wall (left)' },
  { id: 'wall_r',   type: 'wall',        name: 'Wall (right)' },
  { id: 'shelf',    type: 'surface',     name: 'Shelf' },
  { id: 'sill',     type: 'window',      name: 'Window Sill' },
  { id: 'entry',    type: 'door',        name: 'By the Door' },
];

// Дворовые сокеты участка (локальные координаты plot root; +z — к улице)
export const YARD_SLOTS = [
  { id: 'yard_a', type: 'yard', name: 'Front Yard',       x: -4.75, z: 4.6 },
  { id: 'yard_b', type: 'yard', name: 'Courtyard',        x: 1.9,  z: 1.4 },
  { id: 'yard_c', type: 'yard', name: 'By the Shop',      x: 4.85,  z: 5.2 },
];

export const STAGE = {
  id: 2,
  name: 'Settlement',
  hint: 'Metropolis unlocks after the token reaches PumpSwap',
};

export function houseCost(cfg) {
  let cost = 0;
  cost += FOUNDATIONS.find((o) => o.id === cfg.foundation)?.cost || 0;
  cost += (floorCountFor(cfg) - 1) * ADDITIONAL_FLOOR_COST;
  cost += HOUSE_LAYOUTS.find((o) => o.id === (cfg.layout || 'balanced'))?.cost || 0;
  cost += MATERIALS.find((o) => o.id === cfg.material)?.cost || 0;
  cost += ROOFS.find((o) => o.id === cfg.roof)?.cost || 0;
  cost += KITS.find((o) => o.id === cfg.kit)?.cost || 0;
  if (cfg.detail && cfg.detail !== 'none') cost += DETAILS.find((o) => o.id === cfg.detail)?.cost || 0;
  return cost;
}

export function schemeOf(cfg) {
  const m = MATERIALS.find((x) => x.id === cfg.material) || MATERIALS[0];
  return m.schemes.find((s) => s.id === cfg.scheme) || m.schemes[0];
}

/** One household; two more residents for each additional completed floor. */
export function residentsFor(value = 1) {
  return 4 + (floorCountFor(value) - 1) * 2;
}

// Family presentation uses the server-owned catalog and timing configuration.
import { FAMILY_NEEDS, FAMILY_BUSINESSES, FAMILY_BUSINESS_MATERIALS } from '../server/familyRules.js';
export const NEEDS = Object.fromEntries(Object.entries(FAMILY_NEEDS).map(([key, value]) => [
  key === 'familyBond' ? 'bond' : key,
  { ...value, decayPerMin: 100 / value.activeHours / 60 },
]));
export const NEED_FLOOR = 0;
export const NEED_BUY_THRESHOLD = 30;
export const FREE_SERVICE_RESTORE = 0;
export const MARKET = { feePct: 5, priceBand: [0.6, 1.8], restockBatch: 5 };
export const BUSINESS_COST = 600;
export const BUSINESS_TYPES = Object.fromEntries(Object.entries(FAMILY_BUSINESSES).map(([id, business]) => [id, {
  ...business,
  products: business.products.map((product) => ({ ...product, need: product.need === 'familyBond' ? 'bond' : product.need })),
}]));
export const BUSINESS_BY_MATERIAL = FAMILY_BUSINESS_MATERIALS;

/** Old auto-created companions → purchased business categories (migration). */
export const COMPANION_TO_BUSINESS = {
  cafe: 'cafe', flower: 'flower', bakery: 'bakery', workshop: 'techshop',
  library: 'bookstore', gallery: 'flower', techstore: 'techshop', arcade: 'techshop',
};

export function businessForNeed(need) {
  return Object.entries(BUSINESS_TYPES)
    .filter(([, t]) => t.products.some((p) => p.need === need))
    .map(([id]) => id);
}

// ── Builder clearances & item footprints (task5 §9–§10) ──────────────────────
// Stored once in configuration, not hard-coded across systems.
export const CLEARANCES = {
  mainPath: 0.8,
  door: 0.9,
  stair: 1.0,
  interact: 0.6,
  furniture: 0.1,
  wallDecorFromOpening: 0.15,
};

/** Physical footprint (w × d meters) per placement slot type. */
export const SLOT_FOOTPRINT = {
  'floor-large': [1.9, 1.3],
  'floor-med':   [1.3, 0.9],
  'floor-small': [0.7, 0.7],
  'floor-tall':  [0.95, 0.95],
  wall:          [1.4, 0.18],
  surface:       [0.45, 0.35],
  window:        [0.6, 0.35],
  door:          [0.8, 0.6],
};
