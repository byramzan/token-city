// Game state v4 (task4/task5): the game ACCOUNT is the identity, wallets are
// linked verified funding/login/withdrawal methods. All monetary movements go
// through the double-entry ledger (ledger.js) — balances here are only caches.
// Old v3 saves (single wallet, direct coin balance) are migrated on load.

import { TOKEN, levelFor } from './config.js';

const KEY = 'tokencity_v4';
const OLD_KEY = 'tokencity_v3';

export const state = {
  // identity
  account: null,        // { id, createdAt, converted, loginWallet, paymentWallet, withdrawalWallet }
  linkedWallets: [],    // { id, address, provider, network, verifiedAt, roles, status }
  accountArchive: {},   // logged-out account snapshots, indexed by account ID
  walletRegistry: {},   // public address -> game account ID
  walletCooldowns: {},  // public address -> relink allowed timestamp
  walletMeta: {},       // address -> { tokenBalance }  (demo on-chain token side)

  // money (double-entry, see ledger.js)
  ledger: { journal: [], balances: {}, keys: {}, seq: 0 },
  orders: [],           // marketplace orders (escrow lifecycle)

  // world
  houses: [],           // house configs (builder result)
  houseDefinitions: {}, // canonical versioned structures, keyed by houseId
  interiors: {},        // houseId -> { slots (legacy), yard } — yard sockets still live here
  placements: {},       // houseId -> { revision, objects: [...] } — canonical interior (task5)
  placementSaveKeys: {},// idempotencyKey -> canonical save response (task5 §17)
  interiorsBackup: null,// pre-migration copy of old slot interiors (rollback window)
  migrationReports: {}, // houseId -> deterministic migration summary
  houseInventories: {}, // houseId -> owned interior item IDs, synchronized with placements
  inventory: {},        // itemId -> count (items returned to the player, e.g. failed migration)
  businesses: {},       // houseId -> { type, level, reputation, stock, prices, stats, status }
  needs: {},            // houseId -> { hunger, energy, knowledge, bond }
  household: {},        // accountId -> { dailyLimit, autoSpend, categories, day, spentToday }
  links: {},
  visits: {},

  // config & misc
  tokenConfig: null,    // protected token configuration (admin page)
  tokenConfigHistory: [],
  audit: [],            // admin audit log
  dailyUsage: {},       // account/wallet funding and withdrawal limit buckets
  builderDraft: null,   // house draft survives funding trips and reloads (task4 §14)
  interiorDrafts: {},   // houseId -> unsaved floor-aware editor draft (task5 §16)
  muted: false,
};

/**
 * Local game-economy configuration (task8 §8).
 *
 * The blockchain half of the old configuration is gone from the browser: the
 * active chain, token contract, decimals and vault are versioned server-side
 * and delivered by /api/token-config. What stays here is the game's own
 * economy — fees, limits and feature flags — plus a read-only cache of the
 * published token metadata for display.
 */
export const DEFAULT_TOKEN_CONFIG = () => ({
  chainFamily: 'evm',
  chain: null,              // cached sanitized /api/token-config payload
  symbol: TOKEN.name,
  decimals: 18,
  reserveAsset: 'Project token',
  feePct: 0,                // fixed 100 tokens = 1 coin, no conversion fee
  marketplaceFeePct: 5,
  maxSlippagePct: 0,        // fixed rate never slips
  maxDeviationPct: 100,     // fixed rate never deviates
  minLiquidity: 0,
  dailyFundLimit: 1000000,
  dailyWithdrawLimit: 1000000,
  minWithdraw: 1,
  quoteTtlMs: 45000,
  settleHoldMs: 45000,
  flags: { funding: true, marketplace: true, withdrawal: true },
  version: 1,
});

/**
 * Cache the sanitized backend token configuration so the HUD can render the
 * symbol, decimals and explorer link without a second request. It is display
 * data only: nothing here authorizes a deposit or a credit.
 */
export function applyPublicChainConfig(payload) {
  const config = state.tokenConfig;
  if (!config) return null;
  config.chain = payload || null;
  if (payload?.token) {
    config.symbol = payload.token.tokenSymbol || config.symbol;
    config.decimals = Number.isInteger(payload.token.tokenDecimals) ? payload.token.tokenDecimals : config.decimals;
  }
  save();
  return config.chain;
}

export function save() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('tokencity:state-saved'));
  } catch (e) { console.warn('save failed', e); }
}

export function load() {
  if (typeof localStorage === 'undefined') {
    state.tokenConfig = DEFAULT_TOKEN_CONFIG();
    return false;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      Object.assign(state, JSON.parse(raw));
      const defaults = DEFAULT_TOKEN_CONFIG();
      const previousTokenConfig = state.tokenConfig || {};
      state.tokenConfig = {
        ...defaults,
        ...previousTokenConfig,
        flags: { ...defaults.flags, ...(previousTokenConfig.flags || {}) },
      };
      // Old saves carry Solana network profiles. They are dropped from the
      // active configuration but the historical audit trail is untouched.
      delete state.tokenConfig.networkProfiles;
      delete state.tokenConfig.mint;
      delete state.tokenConfig.treasury;
      delete state.tokenConfig.treasuryApi;
      delete state.tokenConfig.rpcUrl;
      delete state.tokenConfig.tokenProgram;
      delete state.tokenConfig.network;
      state.placementSaveKeys ||= {};
      state.dailyUsage ||= {};
      state.accountArchive ||= {};
      state.walletRegistry ||= {};
      state.walletCooldowns ||= {};
      state.migrationReports ||= {};
      state.houseDefinitions ||= {};
      state.interiorDrafts ||= {};
      state.tokenConfigHistory ||= [];
      if (state.account) {
        for (const wallet of state.linkedWallets) state.walletRegistry[wallet.address] = state.account.id;
      }
      upgradeLegacyDemoWallets();
      labelLegacyChainWallets();
      return true;
    }
    // v3 → v4 migration: keep houses, turn the single wallet into an account
    const old = localStorage.getItem(OLD_KEY);
    if (old) return migrateV3(JSON.parse(old));
    state.tokenConfig = DEFAULT_TOKEN_CONFIG();
    return false;
  } catch { state.tokenConfig = DEFAULT_TOKEN_CONFIG(); return false; }
}

function migrateV3(data) {
  state.tokenConfig = DEFAULT_TOKEN_CONFIG();
  state.houses = data.houses || [];
  state.interiors = data.interiors || {};
  state.links = data.links || {};
  state.visits = data.visits || {};
  state.muted = !!data.muted;
  state.interiorsBackup = JSON.parse(JSON.stringify(data.interiors || {}));
  if (data.wallet?.address) {
    const acc = createAccount();
    const w = linkWallet(data.wallet.address, data.wallet.provider || 'demo', { skipSave: true });
    if (w) {
      acc.loginWallet = w.id; acc.paymentWallet = w.id; acc.withdrawalWallet = w.id;
    }
    const oldData = data.wallets?.[data.wallet.address];
    if (oldData) {
      state.walletMeta[data.wallet.address] = { tokenBalance: oldData.tokenBalance ?? TOKEN.startDemoBalance };
      acc.converted = oldData.converted || 0;
      acc.migratedCoins = oldData.coins || 0; // issued into the ledger by main.js after ledger init
    }
    // houses owned by the old wallet address now belong to the account
    for (const h of state.houses) if (h.owner === data.wallet.address) h.owner = acc.id;
  }
  upgradeLegacyDemoWallets();
  save();
  return true;
}

/**
 * Saves created before the Robinhood Chain migration have no chain fields.
 * Their addresses are Solana Base58 public keys, so they are labelled as
 * historical Solana records rather than reinterpreted as EVM addresses.
 */
function labelLegacyChainWallets() {
  const wallets = [
    ...state.linkedWallets,
    ...Object.values(state.accountArchive || {}).flatMap((archive) => archive.linkedWallets || []),
  ];
  for (const wallet of wallets) {
    if (wallet.chainFamily) continue;
    wallet.chainFamily = wallet.provider === 'demo'
      ? 'demo'
      : /^0x[0-9a-fA-F]{40}$/.test(String(wallet.address || '')) ? 'evm' : 'solana';
    wallet.chainId = wallet.chainFamily === 'evm' ? wallet.chainId ?? null : null;
    if (wallet.chainFamily === 'solana') wallet.status = 'historical';
  }
}

const LEGACY_DEMO_BALANCE = 5000;

/** One-time faucet correction for saves created before the funding quick
 * amounts were calibrated. Preserve any tokens already spent or withdrawn. */
function upgradeLegacyDemoWallets() {
  const wallets = [
    ...state.linkedWallets,
    ...Object.values(state.accountArchive || {}).flatMap((archive) => archive.linkedWallets || []),
  ];
  for (const wallet of wallets) {
    if (wallet.provider !== 'demo') continue;
    const meta = state.walletMeta[wallet.address] ||= { tokenBalance: LEGACY_DEMO_BALANCE };
    if ((meta.demoBalanceVersion || 1) >= TOKEN.demoBalanceVersion) continue;
    meta.tokenBalance = Math.max(0, Number(meta.tokenBalance) || 0)
      + (TOKEN.startDemoBalance - LEGACY_DEMO_BALANCE);
    meta.demoBalanceVersion = TOKEN.demoBalanceVersion;
  }
}

// ── account & wallets ────────────────────────────────────────────────────────
export function createAccount() {
  const acc = {
    id: 'acc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    createdAt: Date.now(),
    converted: 0,
    loginWallet: null,
    paymentWallet: null,
    withdrawalWallet: null,
    withdrawalChangedAt: 0,
  };
  state.account = acc;
  return acc;
}

export const MAX_LINKED_WALLETS = 5; // task4 §15.2, backend-configurable

/**
 * Link a wallet to the current account after a verified signed challenge.
 *
 * task8 §9.7/§19.2: a wallet record carries the chain family and chain id it
 * was proven on. Historical Solana wallets keep `chainFamily: 'solana'` and are
 * never treated as Robinhood Chain signing addresses.
 */
export function linkWallet(address, provider, { skipSave = false, chainInfo = {} } = {}) {
  if (!state.account) createAccount();
  if (state.linkedWallets.length >= MAX_LINKED_WALLETS) return null;
  if (state.linkedWallets.some((w) => w.address === address)) return null; // one wallet — one account
  const registeredOwner = state.walletRegistry[address];
  if (registeredOwner && registeredOwner !== state.account.id) return null;
  if ((state.walletCooldowns[address] || 0) > Date.now()) return null;
  const chainFamily = chainInfo.chainFamily || (provider === 'demo' ? 'demo' : 'evm');
  const w = {
    id: 'lw_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    address, provider,
    chainFamily,
    chainId: chainInfo.chainId ?? null,
    chainWalletId: chainInfo.chainWalletId || null,
    network: chainFamily === 'evm' ? 'robinhood-chain' : chainFamily,
    verifiedAt: Date.now(),
    roles: ['payment'],
    status: 'linked',
  };
  state.linkedWallets.push(w);
  state.walletRegistry[address] = state.account.id;
  if (!state.walletMeta[address]) {
    state.walletMeta[address] = {
      tokenBalance: provider === 'demo' ? TOKEN.startDemoBalance : 0,
      ...(provider === 'demo' ? { demoBalanceVersion: TOKEN.demoBalanceVersion } : {}),
    };
  }
  if (!state.account.loginWallet) state.account.loginWallet = w.id;
  if (!state.account.paymentWallet) state.account.paymentWallet = w.id;
  if (!state.account.withdrawalWallet) state.account.withdrawalWallet = w.id;
  if (!skipSave) save();
  return w;
}

export function unlinkWallet(walletId) {
  const idx = state.linkedWallets.findIndex((w) => w.id === walletId);
  if (idx < 0) return false;
  if (state.linkedWallets.length === 1) return false; // keep at least one login method
  const [removed] = state.linkedWallets.splice(idx, 1);
  state.walletCooldowns[removed.address] = Date.now() + 60000;
  const acc = state.account;
  for (const role of ['loginWallet', 'paymentWallet', 'withdrawalWallet']) {
    if (acc[role] === walletId) acc[role] = state.linkedWallets[0]?.id || null;
  }
  save();
  return true;
}

/** Persist the whole game account while ending only the current login session. */
export function archiveCurrentAccount() {
  if (!state.account) return false;
  state.accountArchive[state.account.id] = {
    account: JSON.parse(JSON.stringify(state.account)),
    linkedWallets: JSON.parse(JSON.stringify(state.linkedWallets)),
  };
  for (const wallet of state.linkedWallets) state.walletRegistry[wallet.address] = state.account.id;
  state.account = null;
  state.linkedWallets = [];
  save();
  return true;
}

/** Restore a known account when one of its verified wallets signs in again. */
export function restoreAccountForWallet(address) {
  const accountId = state.walletRegistry[address];
  const archived = accountId ? state.accountArchive[accountId] : null;
  if (!archived || !archived.linkedWallets.some((wallet) => wallet.address === address)) return false;
  state.account = archived.account;
  state.linkedWallets = archived.linkedWallets;
  delete state.accountArchive[accountId];
  save();
  return true;
}

export function walletById(id) { return state.linkedWallets.find((w) => w.id === id) || null; }

export function activeWallet(role = 'paymentWallet') {
  if (!state.account) return null;
  return walletById(state.account[role]) || state.linkedWallets[0] || null;
}

export function tokenMeta(address) {
  if (!state.walletMeta[address]) state.walletMeta[address] = { tokenBalance: 0 };
  return state.walletMeta[address];
}

export function userLevel() {
  return levelFor(state.account ? state.account.converted : 0);
}

export function shortAddr(a) {
  return a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
}

export function makeDemoAddress() {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 44; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// ── world helpers ────────────────────────────────────────────────────────────
export function recordVisit(fromId, toId) {
  if (!state.visits[fromId]) state.visits[fromId] = {};
  state.visits[fromId][toId] = (state.visits[fromId][toId] || 0) + 1;
  if (state.visits[fromId][toId] % 5 === 1) save();
}

export function nameTaken(name) {
  const n = name.trim().toLowerCase();
  return state.houses.some((h) => h.name.trim().toLowerCase() === n);
}

export function addHouse(cfg) {
  state.houses.push(cfg);
  if (!state.interiors[cfg.id]) state.interiors[cfg.id] = { slots: {}, yard: {} };
  save();
  return cfg;
}

export function interiorOf(houseId) {
  if (!state.interiors[houseId]) state.interiors[houseId] = { slots: {}, yard: {} };
  if (!state.interiors[houseId].yard) state.interiors[houseId].yard = {};
  return state.interiors[houseId];
}

/** Canonical interior placements (task5 §17): revisioned, atomic replace. */
export function placementsOf(houseId) {
  if (!state.placements[houseId]) state.placements[houseId] = { revision: 0, objects: [] };
  return state.placements[houseId];
}

/**
 * Local authoritative save boundary for the standalone demo.
 *
 * The caller supplies already validated canonical objects. This function
 * applies the complete revision atomically, rejects stale base revisions and
 * returns the original response for a repeated idempotency key.
 */
export function savePlacementsRevision({
  houseId,
  baseRevision,
  schemaVersion,
  objects,
  idempotencyKey,
  warnings = [],
}) {
  if (!houseId || !idempotencyKey || !Array.isArray(objects)) {
    return { ok: false, error: 'invalid-save-request' };
  }
  if (state.placementSaveKeys[idempotencyKey]) {
    return {
      ...JSON.parse(JSON.stringify(state.placementSaveKeys[idempotencyKey])),
      duplicate: true,
    };
  }
  const current = placementsOf(houseId);
  if (current.revision !== baseRevision) {
    return {
      ok: false,
      error: 'revision-conflict',
      houseId,
      expectedRevision: current.revision,
      canonicalHouseState: JSON.parse(JSON.stringify(current)),
    };
  }
  const response = {
    ok: true,
    houseId,
    schemaVersion,
    newRevision: current.revision + 1,
    acceptedOperations: ['replace-interior-objects'],
    canonicalHouseState: {
      revision: current.revision + 1,
      objects: JSON.parse(JSON.stringify(objects)),
      houseDefinition: null,
    },
    warnings: [...warnings],
    duplicate: false,
  };
  const definition = state.houseDefinitions[houseId]
    ? JSON.parse(JSON.stringify(state.houseDefinitions[houseId]))
    : null;
  if (definition) {
    definition.revision = response.newRevision;
    definition.updatedAt = Date.now();
    for (const floor of definition.floors || []) {
      floor.revision = response.newRevision;
      for (const room of floor.rooms || []) room.objectIds = [];
    }
    for (const object of objects) {
      const floor = definition.floors?.find((entry) => entry.floorId === object.floorId);
      const room = floor?.rooms?.find((entry) => entry.roomId === object.roomId);
      if (room) room.objectIds.push(object.objectInstanceId || object.oid);
    }
    response.canonicalHouseState.houseDefinition = definition;
  }
  // Replace the whole canonical value in one assignment: no partial revision
  // can be observed or persisted.
  state.placements[houseId] = JSON.parse(JSON.stringify(response.canonicalHouseState));
  // Placements keep the canonical object list/revision; the full structure has
  // its own store to avoid duplicating it on every interior read.
  delete state.placements[houseId].houseDefinition;
  if (definition) state.houseDefinitions[houseId] = definition;
  state.placementSaveKeys[idempotencyKey] = JSON.parse(JSON.stringify(response));
  const savedKeys = Object.keys(state.placementSaveKeys);
  if (savedKeys.length > 20) delete state.placementSaveKeys[savedKeys[0]];
  save();
  return JSON.parse(JSON.stringify(response));
}

export function householdOf(accountId) {
  if (!state.household[accountId]) {
    state.household[accountId] = {
      dailyLimit: 60,
      autoSpend: false,      // spec §22: automatic spending is OFF by default
      categories: { food: true, drinks: true, flowers: true, books: true, gadgets: true },
      day: new Date().toDateString(),
      spentToday: 0,
    };
  }
  const hh = state.household[accountId];
  const today = new Date().toDateString();
  if (hh.day !== today) { hh.day = today; hh.spentToday = 0; }
  return hh;
}

export function addInventory(itemId, n = 1) {
  state.inventory[itemId] = (state.inventory[itemId] || 0) + n;
}

export function takeInventory(itemId) {
  if ((state.inventory[itemId] || 0) <= 0) return false;
  state.inventory[itemId]--;
  if (state.inventory[itemId] <= 0) delete state.inventory[itemId];
  return true;
}

export function auditLog(action, meta = {}) {
  state.audit.unshift({ ts: Date.now(), action, ...meta });
  state.audit = state.audit.slice(0, 100);
  save();
}

/** Daily account or wallet limit bucket, reset by local calendar day. */
export function dailyUsageOf(subjectId) {
  const day = new Date().toISOString().slice(0, 10);
  if (!state.dailyUsage[subjectId] || state.dailyUsage[subjectId].day !== day) {
    state.dailyUsage[subjectId] = { day, funded: 0, withdrawn: 0 };
  }
  return state.dailyUsage[subjectId];
}
