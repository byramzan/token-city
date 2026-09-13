import { walletBrandIcon } from './walletIcons.js';
// My Hood — entry point: renderer, modes (city / builder / interior / graph), UI.
// task4: account + multi-wallet, ledger economy, businesses, resident needs,
// fog & WASD. task5: parametric multi-floor interior editor.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  TOKEN, FOUNDATIONS, HEIGHTS, HOUSE_LAYOUTS, MATERIALS, ROOFS, KITS, DETAILS,
  detailAllowed, LINK_TYPES, ITEMS, YARD_SLOTS, SETS, collectionState,
  STAGE, houseCost, levelFor, LEVELS, schemeOf, residentsFor,
  floorCountFor, familyConsumptionFor, constructionSecondsFor, floorExtensionCost, MAX_FLOORS,
  NEEDS, MARKET, BUSINESS_TYPES, BUSINESS_BY_MATERIAL, BUSINESS_COST,
  COMPANION_TO_BUSINESS,
} from './config.js';
import { Bubbles } from './dialogues.js';
import { createWorldMultiplayer } from './multiplayer.js';
import {
  state, save, load, createAccount, linkWallet, unlinkWallet, walletById,
  activeWallet, tokenMeta, userLevel, shortAddr, recordVisit,
  nameTaken, addHouse, interiorOf, placementsOf, householdOf, addInventory,
  takeInventory, auditLog, MAX_LINKED_WALLETS, savePlacementsRevision,
  archiveCurrentAccount, restoreAccountForWallet,
  applyPublicChainConfig, makeDemoAddress,
} from './state.js';
import {
  balancesOf, balance, acct, storeSpend, fundHousehold, returnHousehold,
  settleDueOrders, reconcile, issueCoins, sellerStats, createOrder, deliverOrder, failOrder,
  reverseOperation, attachSharedTrade, importSharedSale,
} from './ledger.js';
import {
  quoteFunding, quoteWithdraw, executeFunding, executeWithdraw, availableCoins,
} from './market.js';
import { createChainService, DEPOSIT_UI_STATES } from './chain/chainService.js';
import { startProviderDiscovery } from './chain/evmWallet.js';
import {
  buildHouseDefinition, migrateLegacyInterior, migrateHouseInterior, defaultResidentialObjects, validateHouseDefinition, validatePlacement, findZone, SCHEMA_VERSION,
} from './houseModel.js';
import { tween, updateTweens, Ease } from './tween.js';
import { sfx, startAmbient, applyMute } from './audio.js';
import { icon } from './icons.js';
import { createHouse, playBuildAnimation, mat, sharedMaterialCount } from './house.js';
import { City, updateSmoke } from './city.js';
import { Residents, needsOf, houseInCrisis } from './residents.js';
import { createFamilyClient, familyAccessFor, walletFamilyAccess } from './familyClient.js';
import { createFamilyPanel, effectsMarkup, formatNeedTime, escapeHtml } from './familyPanel.js';
import { FAMILY_NEEDS, NEED_KEYS, needState } from '../server/familyRules.js';
import { Interior } from './interior.js';
import { buildVisualTestDeck } from './visualTestScene.js';
import {
  configureMaterialLibrary, materialLibraryStats, VISUAL_QUALITY,
} from './materialLibrary.js';

const $ = (id) => document.getElementById(id);

/**
 * Deposit and withdrawal status with a Blockscout link (task8 §13.4).
 * The player can always see whether the token has actually been submitted.
 */
function renderChainHistory() {
  const host = $('acct-chain-history');
  if (!host) return;
  const rows = latestWithdrawals.slice(0, 8);
  if (!rows.length) { host.textContent = 'No on-chain transfers yet.'; return; }
  host.innerHTML = rows.map((row) => {
    const link = row.transactionHash
      ? `<a href="${esc(chain.explorerTx(row.transactionHash))}" target="_blank" rel="noreferrer noopener">Blockscout ↗</a>`
      : '<span class="muted">not submitted yet</span>';
    return `<div>· ${esc(new Date(row.updatedAt).toLocaleTimeString())} — withdrawal ${esc(row.status)}`
      + ` · ${fmt(row.gameCoinAmount)} ${gem} → ${esc(shortAddr(row.walletAddress))} · ${link}`
      + `${row.failureCode ? ` · <span style="color:var(--red)">${esc(row.failureCode)}</span>` : ''}</div>`;
  }).join('');
}

// ── Renderer ─────────────────────────────────────────────────────────────────
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch {
  document.body.innerHTML = '<div style="color:#4a3826;padding:40px;font-family:sans-serif">Sorry, your browser does not support WebGL. Try updating your browser or enabling hardware acceleration.</div>';
  throw new Error('no webgl');
}
configureMaterialLibrary(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, VISUAL_QUALITY.pixelRatioCap));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;

// Read-only runtime counters used by the visual regression checklist and the
// developer guide. No renderer/scene handles are exposed to production code.
const visualFrameSamples = [];
const visualMetricsOutput = document.createElement('output');
visualMetricsOutput.id = 'visual-metrics';
visualMetricsOutput.hidden = true;
document.body.appendChild(visualMetricsOutput);
const readVisualMetrics = () => {
    const frames = [...visualFrameSamples].sort((a, b) => a - b);
    const average = frames.length
      ? frames.reduce((sum, value) => sum + value, 0) / frames.length
      : 0;
    return {
      renderer: `Three.js r${THREE.REVISION}`,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      shaderPrograms: renderer.info.programs?.length || 0,
      averageFrameMs: Number(average.toFixed(2)),
      p95FrameMs: Number((frames[Math.floor(frames.length * 0.95)] || 0).toFixed(2)),
      estimatedFps: average ? Number((1000 / average).toFixed(1)) : 0,
      pixelRatio: renderer.getPixelRatio(),
      shadowMap: renderer.shadowMap.type === THREE.PCFSoftShadowMap ? 'PCFSoft' : 'PCF',
      sharedMaterials: sharedMaterialCount(),
      materialLibrary: materialLibraryStats(),
    };
};
Object.defineProperty(window, '__TOKEN_CITY_VISUAL_METRICS__', {
  configurable: true,
  value: readVisualMetrics,
});

canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  toast('Graphics context lost. Please reload the page.', 'err', 8000);
});

// ── Scenes ───────────────────────────────────────────────────────────────────
const city = new City(renderer);
const residents = new Residents(city.scene, city, {
  linksFor: (houseId) => allLinksOf(houseId),
  onVisit: (from, to) => {
    recordVisit(from, to);
    maybeFormSocialLink(from, to);
  },
  onTrade: (order, bizHouseId) => {
    const bizHouse = state.houses.find((h) => h.id === bizHouseId);
    if (state.account && bizHouse?.owner === state.account.id) {
      refreshHud();
      tradeToastThrottled(order);
    }
    if (selectedHouseId === bizHouseId || selectedHouseId === order.buyer) renderNeeds();
    refreshHomeVitals();
  },
});
const interior = new Interior(renderer);
const bubbles = new Bubbles($('bubbles'), city, residents);

function jsonCopy(value, fallback = null) {
  try { return value == null ? fallback : JSON.parse(JSON.stringify(value)); }
  catch { return fallback; }
}

function completedResidents(cfg) {
  if (cfg.construction?.status === 'building') {
    return cfg.completedFloorCount > 0 ? residentsFor(cfg.completedFloorCount) : 0;
  }
  return residentsFor(cfg);
}

function houseShape(cfg) {
  return JSON.stringify([cfg.foundation, floorCountFor(cfg), cfg.material, cfg.roof, cfg.kit, cfg.detail, cfg.scheme]);
}

function reconcileHouseScene(cfg) {
  let rec = city.houseGroups.get(cfg.id);
  if (rec && houseShape(rec.cfg) !== houseShape(cfg)) {
    city.removeHouse(cfg.id);
    rec = null;
  }
  if (!rec) rec = city.addHouse(cfg, { yard: interiorOf(cfg.id).yard });
  rec.cfg = cfg;
  residents.addForHouse(rec, completedResidents(cfg));
  ensureBusinessVisual(cfg);
  return rec;
}

function publicHouseDocument(house, overrides = {}) {
  const id = house.id;
  return {
    version: Number(overrides.version) || 0,
    updatedAt: Number(overrides.updatedAt) || Date.now(),
    house: jsonCopy(house, {}),
    definition: jsonCopy(overrides.definition ?? state.houseDefinitions[id], null),
    interior: jsonCopy(overrides.interior ?? state.interiors[id], { slots: {}, yard: {} }),
    placements: jsonCopy(overrides.placements ?? state.placements[id], { revision: 0, objects: [] }),
    interiorInventory: jsonCopy(state.houseInventories[id], []),
    business: jsonCopy(overrides.business ?? state.businesses[id], null),
    needs: null, // private household state never enters the shared city feed
    links: jsonCopy(overrides.links ?? state.links[id], []),
  };
}

function assignPublicHouseDocument(document) {
  const cfg = jsonCopy(document.house, null);
  if (!cfg?.id) return null;
  const index = state.houses.findIndex((house) => house.id === cfg.id);
  if (index < 0) state.houses.push(cfg); else state.houses[index] = cfg;
  if (document.definition) state.houseDefinitions[cfg.id] = jsonCopy(document.definition);
  else delete state.houseDefinitions[cfg.id];
  state.interiors[cfg.id] = jsonCopy(document.interior, { slots: {}, yard: {} });
  state.placements[cfg.id] = jsonCopy(document.placements, { revision: 0, objects: [] });
  if (!(editingInterior && currentInteriorHouse?.id === cfg.id)) {
    state.houseInventories[cfg.id] = jsonCopy(document.interiorInventory, []);
  }
  if (document.business) state.businesses[cfg.id] = jsonCopy(document.business);
  else delete state.businesses[cfg.id];
  // Needs arrive only through the owner's private household subscription.
  state.links[cfg.id] = jsonCopy(document.links, []);
  return cfg;
}

function addRemoteHouseToScene(cfg, { announce = true } = {}) {
  if (city.houseGroups.has(cfg.id)) return city.houseGroups.get(cfg.id);
  const rec = city.addHouse(cfg, { yard: interiorOf(cfg.id).yard });
  residents.addForHouse(rec, completedResidents(rec.cfg));
  ensureBusinessVisual(cfg);
  updateReserveFlag(cfg.id);
  if (announce) {
    rec.root.scale.setScalar(0.05);
    tween({
      duration: 620, ease: Ease.outBack,
      onUpdate: (k) => rec.root.scale.setScalar(Math.max(0.05, k)),
    });
    toast(`A new multiplayer home “${cfg.name}” appeared in the city`, 'ok', 4300);
  }
  return rec;
}

function ensureBusinessVisual(cfg) {
  const business = state.businesses[cfg.id];
  const businessType = business && BUSINESS_TYPES[business.type];
  if (!businessType || cfg.companion) return null;
  return city.addBusinessBuilding(cfg.id, business.type, businessType, { animate: false });
}

function applyWorldSnapshot(documents) {
  const valid = documents.filter((document) => document?.house?.id);
  const incomingIds = new Set(valid.map((document) => document.house.id));
  for (const cfg of [...state.houses]) {
    if (incomingIds.has(cfg.id)) continue;
    city.removeHouse(cfg.id);
    residents.removeForHouse(cfg.id);
  }
  state.houses = [];
  state.houseDefinitions = {};
  state.interiors = {};
  state.placements = {};
  state.businesses = {};
  state.links = {};
  for (const document of valid) assignPublicHouseDocument(document);
  for (const plot of city.plots) plot.taken = false;
  for (const cfg of state.houses) {
    const plot = city.plots[cfg.plot?.i];
    if (plot) plot.taken = true;
    const record = city.houseGroups.get(cfg.id);
    if (record) reconcileHouseScene(cfg);
    else if (city.houseGroups.size) addRemoteHouseToScene(cfg, { announce: false });
  }
  save();
  refreshHud();
}

function applyRemoteHouse(document) {
  const existed = state.houses.some((house) => house.id === document?.house?.id);
  const cfg = assignPublicHouseDocument(document);
  if (!cfg) return;
  save();
  const record = city.houseGroups.has(cfg.id) ? reconcileHouseScene(cfg) : null;
  if (!record) addRemoteHouseToScene(cfg, { announce: true });
  else {
    record.cfg = cfg;
    const nextYard = interiorOf(cfg.id).yard || {};
    for (const slotId of Object.keys(record.yardItems || {})) {
      if (!nextYard[slotId]) city.removeYardItem(cfg.id, slotId);
    }
    for (const [slotId, itemId] of Object.entries(nextYard)) {
      if (record.yardItems?.[slotId]?.userData.itemId !== itemId) city.placeYardItem(cfg.id, slotId, itemId, false);
    }
    ensureBusinessVisual(cfg);
  }
  const updatedRecord = city.houseGroups.get(cfg.id);
  if (updatedRecord) updatedRecord.serverClock = { at: document.serverTimestamp || document.updatedAt, received: performance.now() };
  updateReserveFlag(cfg.id);
  refreshHud();
  if (selectedHouseId === cfg.id && !$('house-card').classList.contains('hidden')) selectHouse(cfg.id);
  if (selectedHouseId === cfg.id && !$('modal-marketplace').classList.contains('hidden')
      && cfg.owner !== state.account?.id && state.businesses[cfg.id]) {
    openMarketplace(cfg.id);
  }
  if (selectedHouseId === cfg.id && !$('modal-bizmanage').classList.contains('hidden')
      && cfg.owner === state.account?.id && state.businesses[cfg.id]) {
    openBizManage(cfg.id);
  }
  if (!existed) state.links[cfg.id] = city.computeLinks(cfg, state.houses, state.visits);
  if (mode === 'interior' && currentInteriorHouse?.id === cfg.id && !editingInterior) {
    const floor = interior.activeFloor;
    currentInteriorHouse = cfg;
    interior.build(cfg, placementsOf(cfg.id), state.houseDefinitions[cfg.id]);
    interior.setFloor(Math.min(floor, floorCountFor(cfg) - 1));
    renderFloorTabs();
  }
}

/**
 * Robinhood Chain service (task8 §16.3). Private deposit, withdrawal and
 * balance events travel over the same authorized Convex socket as the house
 * and business feed; no provider WebSocket is ever exposed to the browser.
 */
const chain = createChainService({
  getConvexClient: () => multiplayer.convexClient(),
  getAccountId: () => state.account?.id || '',
  onEvent: (event) => handleChainEvent(event),
});

function handleChainEvent(event) {
  if (event.type === 'token_config_refreshed') {
    publicContractAddress = event.config?.token?.tokenAddress || '';
    renderPublicContractAddress();
    // The configuration can arrive before the saved game state is loaded.
    if (state.tokenConfig) refreshHud();
    return;
  }
  if (event.type === 'wallet_network_changed') {
    if (event.change?.type === 'chainChanged' && event.change.correct === false) {
      toast(`Your wallet left ${chain.network().networkName}. Switch back before depositing.`, 'err', 6000);
    }
    refreshHud();
    return;
  }
  if (event.type === 'deposit_status_changed') {
    applyCreditedDeposits(event.deposits || []);
    return;
  }
  if (event.type === 'withdrawal_status_changed') {
    latestWithdrawals = event.withdrawals || [];
    for (const row of latestWithdrawals) {
      const seenKey = `${row.withdrawalId}:${row.status}`;
      if (seenWithdrawalStates.has(seenKey)) continue;
      if (row.status === 'FAILED') {
        seenWithdrawalStates.add(seenKey);
        // task8 §13.5: the transfer never reached the chain, so the internal
        // deduction is reversed. A reversal that already ran is idempotent
        // because the ledger key is the withdrawal id.
        if (!row.transactionHash && state.account) {
          const result = issueCoins(state.account.id, row.gameCoinAmount, {
            signature: `rhc-reversal:${row.withdrawalId}`, reason: 'withdraw-reversal', reserveValue: row.gameCoinAmount,
          });
          if (!result?.duplicate) {
            save();
            refreshHud();
            toast(`A withdrawal could not be sent (${esc(row.failureCode || 'unknown reason')}). ${fmt(row.gameCoinAmount)} ${gem} returned to your balance.`, 'err', 8000);
            continue;
          }
        }
        toast(`A withdrawal needs manual reconciliation (${esc(row.failureCode || 'unknown reason')}). No second transfer is sent automatically.`, 'err', 8000);
      } else if (row.status === 'COMPLETED') {
        seenWithdrawalStates.add(seenKey);
        toast(`Withdrawal sent · ${esc(shortAddr(row.walletAddress))} · view it on Blockscout`, 'ok', 6000);
      }
    }
    if (!$('modal-account').classList.contains('hidden')) renderChainHistory();
  }
}

const seenWithdrawalStates = new Set();
let latestWithdrawals = [];
let inFlightDepositId = null;

/**
 * Credit Game Coins for deposits the backend already verified and settled.
 * The amount is the server-issued `expectedGameCoins`; the ledger key is the
 * deposit id, so a replayed event can never credit twice (task8 §11.5, §12).
 */
function applyCreditedDeposits(deposits) {
  if (!state.account) return;
  let credited = 0;
  for (const deposit of deposits) {
    if (deposit.status !== 'CREDITED') continue;
    // The funding screen credits the deposit it is driving itself, so the
    // subscription must not race it into a false duplicate error.
    if (deposit.depositId === inFlightDepositId) continue;
    const result = issueCoins(state.account.id, deposit.expectedGameCoins, {
      signature: `rhc:${deposit.depositId}`, reason: 'deposit', reserveValue: deposit.expectedGameCoins,
    });
    if (result?.duplicate) continue;
    credited += deposit.expectedGameCoins;
  }
  if (credited > 0) {
    save();
    refreshHud();
    toast(`Deposit settled on ${chain.network().networkName} · ${fmt(credited)} ${gem} credited`, 'ok', 5200);
  }
}

function setMultiplayerStatus(status) {
  const element = $('multiplayer-status');
  if (!element) return;
  const labels = { online: 'Live', connecting: 'Connecting…', syncing: 'Syncing…', offline: 'Offline' };
  element.className = `multiplayer-status ${status}`;
  element.textContent = labels[status] || status;
  element.title = status === 'online'
    ? 'Shared city is synchronized in real time'
    : 'Reconnecting to the shared city';
}

const multiplayer = createWorldMultiplayer({
  getDocuments: () => state.houses.map((house) => publicHouseDocument(house)),
  getAccessKey: (accountId) => familyAccessFor(accountId),
  canSyncDocument: (document) => Boolean(
    state.account?.id && document?.house?.owner === state.account.id
    && !(editingInterior && currentInteriorHouse?.id === document.house.id)
  ),
  onSnapshot: applyWorldSnapshot,
  onHouseUpsert: applyRemoteHouse,
  onTrade: (trade, { replay } = {}) => {
    if (!state.account || trade?.sellerId !== state.account.id) return;
    if (!importSharedSale(trade)) return;
    refreshHud();
    const product = BUSINESS_TYPES[state.businesses[trade.houseId]?.type]?.products
      .find((entry) => entry.id === trade.productId);
    if (!replay) tradeToastThrottled({
      product: product?.name || trade.productId,
      gross: trade.gross,
      fee: trade.fee,
    });
    if (selectedHouseId === trade.houseId && !$('modal-bizmanage').classList.contains('hidden')) {
      openBizManage(trade.houseId);
    }
  },
  onStatus: (status) => {
    setMultiplayerStatus(status);
    // Reconnecting restores the world feed and the private chain channels
    // together, then reloads canonical state (task8 §16.2).
    if (status === 'online') {
      chain.subscribe();
      void refreshPublicContractAddress();
    }
  },
});

let familyStarting = null;
let lastFamilyCrisis = '';
const familyClient = createFamilyClient({
  onChange: (family) => {
    state.needs[family.houseId] = {
      ...family.needs, bond: family.needs.familyBond,
      activeCrisisNeed: family.activeCrisisNeed,
      serverAuthoritative: true, stateRevision: family.stateRevision,
    };
    refreshHomeVitals();
    renderNeeds();
    if (!$('modal-family').classList.contains('hidden')) familyPanel.render();
    const crisisKey = family.activeCrisisNeed ? family.houseId + ':' + family.activeCrisisNeed : '';
    if (crisisKey && crisisKey !== lastFamilyCrisis) {
      familyPanel.open();
      toast(`${FAMILY_NEEDS[family.activeCrisisNeed].name} crisis: restore this need to 20.`, 'err', 6500);
    }
    lastFamilyCrisis = crisisKey;
  },
  onStatus: (status, message) => {
    if (message) $('home-vitals-status').textContent = message;
  },
});
const familyPanel = createFamilyPanel({
  client: familyClient, getHouse: primaryOwnedHouse, ensure: () => ensureFamilySession(true),
  openShop: (id) => { selectedHouseId = id; openMarketplace(id); },
  review: reviewAction, onError: (message) => toast(message, 'err', 5500),
  emergency: (offer) => {
    const eventId = 'emergency_' + crypto.randomUUID();
    let spend = null;
    return reviewAction({
    title: offer.name,
    body: `<p>No suitable player offer has been available through the emergency grace period.</p><p>Recover ${FAMILY_NEEDS[offer.need].name} to <b>20</b> for <b>${fmt(offer.price)} coins</b>. No bonus effect.</p>`,
    label: 'Confirm emergency support',
    onConfirm: async () => {
      await ensureFamilySession(true);
      spend ||= storeSpend(state.account.id, offer.price, offer.name, eventId);
      if (!spend) throw new Error('Not enough Game Coins.');
      try {
        await multiplayer.purchaseEmergency({ accountId: state.account.id, houseId: familyClient.houseId,
          purchaseKey: eventId, expectedPrice: offer.price, fee: 0 });
        await familyClient.refresh();
      }
      catch (error) {
        if (error.message !== 'multiplayer-timeout') { reverseOperation(spend.opId, error.message, 'reverse_' + eventId); spend = null; }
        throw error;
      }
      refreshHud(); familyPanel.render();
    },
    });
  },
});

function reviewAction({ title, body, label = 'Confirm', onConfirm }) {
  $('review-title').textContent = title;
  $('review-content').innerHTML = body;
  $('review-error').textContent = '';
  const button = $('review-confirm');
  button.textContent = label;
  button.disabled = false;
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = 'Saving…';
    try { await onConfirm(); hidePanel('modal-review'); }
    catch (error) { $('review-error').textContent = error.message || 'Please try again.'; }
    finally { button.disabled = false; button.textContent = label; }
  };
  showPanel('modal-review');
}

async function ensureFamilyAccess(interactive = true) {
  // The wallet is the login: family access requires a connected, verified wallet.
  if (!state.account || state.linkedWallets.length === 0) {
    throw new Error('Connect your wallet to play — your wallet is your account.');
  }
  const stored = familyAccessFor(state.account.id);
  if (stored) return stored;
  const wallet = activeWallet('loginWallet') || activeWallet('paymentWallet');
  if (!wallet) throw new Error('Connect your wallet to play — your wallet is your account.');
  if (!interactive) return '';
  // A deterministic signature derives a private capability that reconstructs
  // with the same wallet. It is never included in a public house document.
  const signature = await chain.signMessage(JSON.stringify({
    application: 'My Hood', purpose: 'Private family access v1',
    walletAddress: wallet.address, accountId: state.account.id,
  }));
  return walletFamilyAccess(state.account.id, signature);
}

async function ensureFamilySession(interactive = false) {
  const home = primaryOwnedHouse();
  if (!home) throw new Error('Build your family house first.');
  if (familyClient.houseId === home.id && familyClient.state) return familyClient.state;
  if (familyStarting) return familyStarting;
  familyStarting = (async () => {
    const accessKey = await ensureFamilyAccess(interactive);
    if (!accessKey) return null;
    return familyClient.connect({ accountId: state.account.id, houseId: home.id, accessKey });
  })();
  try { return await familyStarting; } finally { familyStarting = null; }
}

$('btn-family').onclick = $('hc-family').onclick = () => {
  familyPanel.open();
  void ensureFamilySession(true).then(() => familyPanel.render()).catch((error) => toast(error.message, 'err'));
};

let lastTradeToast = 0;
function tradeToastThrottled(order) {
  if (Date.now() - lastTradeToast < 12000) return;
  lastTradeToast = Date.now();
  toast(`Your business sold “${order.product}” — ${order.gross - order.fee} ${gem} pending settlement`, 'ok');
}

/** Reserve-collection items nearby unlock the Meme Reserve dialogue set. */
function updateReserveFlag(houseId) {
  const rec = city.houseGroups.get(houseId);
  if (!rec) return;
  const yard = Object.values(interiorOf(houseId).yard);
  const placed = placementsOf(houseId).objects.map((o) => o.itemId);
  rec.hasReserveItems = [...yard, ...placed].some((itemId) => ITEMS.find((i) => i.id === itemId)?.collection === 'meme_reserve');
}

// Builder preview scene
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color('#8ed9ef');
previewScene.fog = new THREE.Fog('#8ed9ef', 60, 120); // §26: mild preview fog only far away
const previewHemi = new THREE.HemisphereLight('#fff0d1', '#9b7a54', 1.08);
const previewSun = new THREE.DirectionalLight('#ffe5ad', 1.65);
{
  previewSun.position.set(14, 22, 12);
  previewSun.castShadow = true;
  previewSun.shadow.mapSize.set(1024, 1024);
  previewSun.shadow.camera.left = -15; previewSun.shadow.camera.right = 15;
  previewSun.shadow.camera.top = 15; previewSun.shadow.camera.bottom = -15;
  previewSun.shadow.bias = -0.00012;
  previewSun.shadow.normalBias = 0.035;
  previewSun.shadow.radius = 1.5;
  const previewFill = new THREE.AmbientLight('#ffd9b5', 0.3);
  previewScene.add(previewHemi, previewSun, previewFill);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(26, 28),
    mat('#fff3cf', { textureKind: 'grass', textureRepeat: [2.8, 2.8] }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  previewScene.add(ground);
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(7, 7.6, 0.3, 24),
    mat('#e3d5ae', { textureKind: 'pavers', textureRepeat: [3, 3] }),
  );
  pad.position.y = 0.15;
  pad.receiveShadow = true;
  previewScene.add(pad);
}
const previewCam = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 200);
const previewControls = new OrbitControls(previewCam, canvas);
previewControls.enableDamping = true;
previewControls.minDistance = 8;
previewControls.maxDistance = 30;
previewControls.maxPolarAngle = 1.45;
previewControls.autoRotate = true;
previewControls.autoRotateSpeed = 1.0;
previewControls.target.set(0, 2.4, 0);
previewCam.position.set(11, 7, 11);
previewControls.enabled = false;
let previewHouse = null;
let previewNight = false;

// ── Modes ────────────────────────────────────────────────────────────────────
let mode = 'city'; // city | builder | interior
let graphMode = false;
let graphHouseId = null;
let currentInteriorHouse = null;
let editingInterior = false;
let selectedHouseId = null;
let yardEditingHouse = null;

function setMode(m) {
  mode = m;
  city.controls.enabled = m === 'city';
  previewControls.enabled = m === 'builder';
  interior.controls.enabled = m === 'interior';
  $('hud').classList.toggle('hidden', m !== 'city' || graphMode);
  $('builder').classList.toggle('hidden', m !== 'builder');
  $('interior-ui').classList.toggle('hidden', m !== 'interior');
  if (m !== 'city') hidePanel('house-card');
}

// ── UI helpers ───────────────────────────────────────────────────────────────
function toast(msg, kind = '', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, ms);
}
function showPanel(id) { $(id).classList.remove('hidden'); }
function hidePanel(id) { $(id).classList.add('hidden'); }
document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => { sfx.click(); hidePanel(b.dataset.close); });
});

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
const gem = icon('gem');
const coinIc = icon('coin');
let publicContractAddress = '';

function renderPublicContractAddress() {
  const value = $('contract-address-value');
  const button = $('contract-address-copy');
  if (!value || !button) return;
  // The address stays masked in the UI, but the button copies it when present.
  value.textContent = '######';
  button.title = publicContractAddress
    ? `Copy contract address: ${publicContractAddress}`
    : 'Copy contract address';
}

/**
 * The published contract address comes from the versioned backend
 * configuration, never from a value typed into this browser (task8 §8).
 */
async function refreshPublicContractAddress() {
  try {
    const payload = await chain.loadConfig({ force: true });
    applyPublicChainConfig(payload);
    publicContractAddress = String(payload?.token?.tokenAddress || '').trim();
  } catch {
    publicContractAddress = '';
  }
  renderPublicContractAddress();
}

$('contract-address-copy')?.addEventListener('click', async () => {
  sfx.click();
  const text = publicContractAddress || '######';
  try {
    await navigator.clipboard.writeText(text);
    toast('Contract address copied', 'ok');
  } catch {
    toast('Could not copy — try again', 'err');
  }
});
setInterval(() => { if (document.visibilityState === 'visible') void refreshPublicContractAddress(); }, 30_000);
addEventListener('focus', () => { void refreshPublicContractAddress(); });

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

function applyStaticUi() {
  document.querySelectorAll('[data-ic]').forEach((el) => {
    el.innerHTML = icon(el.dataset.ic) + el.innerHTML;
  });
  $('stage-badge').innerHTML = `${icon('lock')} Stage ${STAGE.id} · ${STAGE.name}`;
  $('stage-badge').title = `${STAGE.hint} — the stage is shared by the whole town`;
  $('btn-build').innerHTML = `${icon('hammer')} Build Your House`;
  $('btn-fund').innerHTML = `${icon('swap')} Add Funds`;
  $('btn-find').innerHTML = `${icon('search')} Find My Home`;
  $('hc-inside').innerHTML = `${icon('eye')} Look Inside`;
  $('hc-share').innerHTML = `${icon('share')} Share Link`;
  $('hc-links').innerHTML = `${icon('graph')} View Connections`;
  $('graph-exit').innerHTML = `${icon('left')} Back to Town`;
  $('builder-exit').innerHTML = `${icon('left')} Cancel`;
  $('builder-prev').innerHTML = `${icon('left')} Back`;
  $('interior-exit').innerHTML = `${icon('left')} Back to Town`;
  $('builder-daynight').innerHTML = icon('moon');
  $('acct-add-wallet').innerHTML = `${icon('wallet')} Add wallet`;
  $('acct-withdraw').innerHTML = `${icon('swap')} Withdraw`;
}

/**
 * Read the ERC-20 balance and the separate ETH gas balance for one linked
 * wallet (task8 §10). Both values come from the backend, which reads them from
 * Robinhood Chain — a client-side number is never authoritative.
 */
async function refreshOnChainBalance(wallet, { quiet = true } = {}) {
  if (!wallet || wallet.provider === 'demo' || wallet.chainFamily === 'solana') return;
  try {
    const result = await chain.balances(wallet.address);
    if (!result) return;
    const meta = tokenMeta(wallet.address);
    meta.tokenBalance = result.token ? Number(result.token.displayAmount) : 0;
    meta.rawTokenBalance = result.token?.rawAmount || '0';
    meta.tokenDecimals = result.token?.decimals ?? null;
    meta.gasBalance = result.nativeDisplay;
    meta.gasWarning = result.gasWarning;
    meta.chainId = result.chainId;
    save();
    refreshHud();
    if (!quiet && result.gasWarning) toast(result.gasWarning, 'err', 6000);
  } catch (error) {
    if (!quiet) toast(error?.message || 'Could not read the token balance', 'err');
  }
}

function refreshHud() {
  const acc = state.account;
  $('balances').classList.toggle('hidden', !acc);
  $('btn-fund').classList.toggle('hidden', !acc);
  if (acc) {
    const payW = activeWallet('paymentWallet');
    const b = balancesOf(acc.id);
    $('chip-token').innerHTML = `${coinIc} ${payW ? fmt(tokenMeta(payW.address).tokenBalance) : 0}`;
    $('chip-coins').innerHTML = `${gem} ${fmt(b.available)}`;
    $('chip-pending').innerHTML = `⏳ ${fmt(b.pending)}`;
    $('chip-pending').classList.toggle('hidden', b.pending <= 0);
    const lvl = userLevel();
    $('chip-level').innerHTML = `${icon('star')} Lv ${lvl.level} · ${lvl.title}`;
    const loginW = activeWallet('loginWallet');
    $('btn-wallet').innerHTML = `${icon('wallet')} ${loginW ? shortAddr(loginW.address) : 'Account'}`;
  } else {
    $('btn-wallet').innerHTML = `${icon('wallet')} Connect Wallet`;
  }
  $('btn-sound').innerHTML = icon(state.muted ? 'mute' : 'sound');
  // The chain is fixed by the deployment (task8 §17): the player cannot switch
  // the game between networks from the HUD any more.
  const network = chain.network();
  const isMainnet = network.networkType === 'mainnet';
  $('btn-network').textContent = isMainnet ? 'Robinhood Chain' : 'RHC Testnet';
  $('btn-network').classList.toggle('mainnet', isMainnet);
  $('btn-network').title = `${network.networkName} · chain id ${network.chainId} · gas token ${network.nativeCurrency.symbol}`;
  $('chip-houses').innerHTML = `${icon('home')} ${state.houses.length}`;
  const pop = state.houses.reduce((s, house) => s + completedResidents(house), 0);
  $('chip-pop').innerHTML = `${icon('ghost')} ${pop}`;
  const mine = acc ? state.houses.filter((h) => h.owner === acc.id) : [];
  $('btn-find').classList.toggle('hidden', mine.length === 0);
  refreshHomeVitals();
  if (mine.length) void ensureFamilySession(false).catch(() => {});
  else if (familyClient.houseId) familyClient.disconnect();
}

// ── auto-hiding HUD ──────────────────────────────────────────────────────────
let idleTimer = null;
function wakeUi() {
  $('hud').classList.remove('sleep');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (mode === 'city' && !graphMode) $('hud').classList.add('sleep');
  }, 8000);
}
addEventListener('pointermove', wakeUi, { passive: true });
addEventListener('pointerdown', wakeUi, { passive: true });
wakeUi();

// ── Wallet connection modal (task4 §16) ──────────────────────────────────────
let walletModalMode = 'connect'; // 'connect' first wallet | 'add' link another
let walletConnectPending = false;

/**
 * The wallet is the login. Any gameplay action (building, interiors, business,
 * family) requires a connected, verified wallet. Returns true when the player
 * may proceed; otherwise it opens the connect modal and returns false.
 */
function requireWallet() {
  const hasWallet = Boolean(state.account && state.linkedWallets.length > 0);
  if (hasWallet) return true;
  toast('Connect your wallet to play — your wallet is your account.', 'err', 5000);
  openWalletModal('connect');
  return false;
}

function openWalletModal(modeArg = 'connect') {
  walletModalMode = modeArg;
  $('wallet-modal-title').textContent = modeArg === 'add' ? 'Link another wallet' : 'Connect a wallet';
  $('wallet-search').value = '';
  renderWalletList();
  showPanel('modal-wallet');
  setTimeout(() => {
    if (!$('modal-wallet').classList.contains('hidden')) renderWalletList();
  }, 350);
}

$('wallet-search').addEventListener('input', renderWalletList);
$('wallet-refresh').addEventListener('click', () => {
  sfx.click();
  startProviderDiscovery();
  renderWalletList();
});
// EIP-6963 wallets announce themselves asynchronously, so the list refreshes
// when a new provider appears instead of asking the player to reload.
addEventListener('eip6963:announceProvider', () => {
  if (!$('modal-wallet').classList.contains('hidden')) renderWalletList();
});

function walletLogo(url, name, extraClass = '') {
  return url
    ? `<span class="wallet-logo ${extraClass}"><img src="${esc(url)}" alt="${esc(name)} logo" width="40" height="40" decoding="async" referrerpolicy="no-referrer" /></span>`
    : `<span class="wallet-logo wallet-logo-fallback ${extraClass}">${icon('wallet')}</span>`;
}

function renderWalletList() {
  const list = $('wallet-list');
  const query = $('wallet-search').value.trim().toLowerCase();
  list.innerHTML = '';
  const wallets = chain.availableWallets()
    .filter((wallet) => !query || wallet.name.toLowerCase().includes(query));
  const installedCount = chain.availableWallets().filter((wallet) => wallet.installed).length;
  const network = chain.network();
  $('wallet-detected').textContent = walletConnectPending
    ? 'Waiting for approval in the wallet…'
    : installedCount
      ? `${installedCount} ${network.networkName} compatible wallet${installedCount === 1 ? '' : 's'} detected`
      : `No EVM wallet detected in this browser · ${network.networkName} chain id ${network.chainId}`;
  for (const wallet of wallets) {
    const linked = state.linkedWallets.some((entry) => entry.provider === wallet.id);
    const row = document.createElement(wallet.installed ? 'button' : 'div');
    row.className = `wallet-row ${wallet.installed ? 'available' : 'unavailable'}`;
    if (wallet.installed) {
      row.type = 'button';
      row.disabled = walletConnectPending;
    }
    row.innerHTML = `
      ${walletLogo(wallet.icon, wallet.name)}
      <span class="w-meta"><b>${esc(wallet.name)}</b>
        ${wallet.installed
          ? '<span class="w-installed">Ready to connect</span>'
          : '<small>Not detected in this browser</small>'}
        ${wallet.note ? `<small>· ${esc(wallet.note)}</small>` : ''}
        ${linked ? '<small>· already linked</small>' : ''}
      </span>
      ${wallet.installed
        ? `<span class="wallet-action">${walletConnectPending ? 'Waiting…' : 'Connect'}</span>`
        : `<button class="wallet-install" type="button">Install / Open ↗</button>`}`;
    if (wallet.installed) {
      row.addEventListener('click', () => handleWalletClick(wallet));
    } else {
      row.querySelector('.wallet-install').addEventListener('click', () => {
        sfx.click();
        if (wallet.url) open(wallet.url, '_blank', 'noopener,noreferrer');
        else toast(`${wallet.name} does not provide an install page`, 'err');
      });
    }
    list.appendChild(row);
  }
  $('wallet-security-note')?.replaceChildren(document.createTextNode(
    `Connect the wallet that holds the configured token. My Hood will never ask for your recovery phrase or private key.`,
  ));
}

/**
 * Connect, switch to Robinhood Chain, then prove ownership with a one-time
 * signed challenge (task8 §9.4, §9.6). No key or phrase is ever requested.
 */
async function handleWalletClick(wallet) {
  sfx.click();
  if (walletConnectPending) {
    toast('A wallet request is already open. Finish it before starting another one.', 'err', 5200);
    return;
  }
  walletConnectPending = true;
  renderWalletList();
  try {
    const connection = await chain.connect(wallet.id);
    // The signed challenge is issued for a game account, so a returning player
    // is restored before signing rather than after.
    const returning = !state.account && restoreAccountForWallet(connection.address);
    if (!state.account) createAccount();
    const link = await chain.signIn();
    if (returning && state.linkedWallets.some((entry) => entry.address === link.address)) {
      hidePanel('modal-wallet');
      refreshHud();
      void refreshOnChainBalance(state.linkedWallets.find((entry) => entry.address === link.address), { quiet: false });
      toast(`Welcome back — the same account and house were restored with ${shortAddr(link.address)}`, 'ok');
      return;
    }
    finishConnect(link.address, wallet.id, {
      chainFamily: 'evm', chainId: link.chainId, chainWalletId: link.walletId,
    });
  } catch (error) {
    if (error?.installUrl) {
      toast(`${wallet.name} is not available in this browser. Use its Install / Open button.`, 'err', 5200);
    } else {
      toast(chain.walletErrorMessage(error), 'err', 6000);
    }
  } finally {
    walletConnectPending = false;
    if (!$('modal-wallet').classList.contains('hidden')) renderWalletList();
  }
}

function finishConnect(address, provider, chainInfo = {}) {
  if (!state.account && restoreAccountForWallet(address)) {
    hidePanel('modal-wallet');
    refreshHud();
    toast(`Welcome back — the same account and house were restored with ${shortAddr(address)}`, 'ok');
    return;
  }
  const firstTime = !state.account;
  if (state.linkedWallets.some((w) => w.address === address)) {
    toast('This wallet is already linked to your account', 'err');
    return;
  }
  if (state.walletRegistry[address] && state.walletRegistry[address] !== state.account?.id) {
    toast('This wallet is already linked to another game account', 'err');
    return;
  }
  const w = linkWallet(address, provider, { chainInfo });
  if (!w) {
    toast(state.linkedWallets.length >= MAX_LINKED_WALLETS
      ? `Wallet limit reached (${MAX_LINKED_WALLETS} per account)`
      : 'This wallet is temporarily unavailable because of a security cooldown', 'err');
    return;
  }
  hidePanel('modal-wallet');
  refreshHud();
  if (firstTime) {
    toast(`Wallet connected. Token balances are test-mode (Stage ${STAGE.id} · ${STAGE.name}).`, 'ok');
  } else {
    toast(`Wallet ${shortAddr(address)} linked — same account, same house`, 'ok');
    if (!$('modal-account').classList.contains('hidden')) renderAccount();
  }
  save();
  if (provider !== 'demo') refreshOnChainBalance(w, { quiet: false });
}

$('btn-wallet').addEventListener('click', () => {
  sfx.click();
  if (state.account) { renderAccount(); showPanel('modal-account'); }
  else openWalletModal('connect');
});

// Temporary demo wallet (for screenshots/testing). Grants a test-token balance
// (TOKEN.startDemoBalance) with no real chain link. Removed on the reset step.
$('wallet-demo')?.addEventListener('click', () => {
  sfx.click();
  finishConnect(makeDemoAddress(), 'demo', { chainFamily: 'demo' });
});

// ── Account panel (task4 §15) ────────────────────────────────────────────────
const ROLE_LABELS = { paymentWallet: 'Pay', loginWallet: 'Login', withdrawalWallet: 'Withdraw' };

function renderAccount() {
  const acc = state.account;
  if (!acc) return;
  const b = balancesOf(acc.id);
  $('acct-balances').innerHTML = [
    ['Available', b.available, 'spend or withdraw'],
    ['Pending', b.pending, 'settling sales'],
    ['Locked', b.locked, 'open orders'],
    ['Household', b.household, 'resident budget'],
    ['Promo', b.promo, 'not withdrawable'],
  ].map(([n, v, hint]) => `<div class="acct-bal" title="${hint}">${n}<b>${fmt(v)}</b></div>`).join('');
  const goods = Object.entries(state.inventory)
    .filter(([id, count]) => id.startsWith('product:') && count > 0)
    .map(([id, count]) => {
      const [, businessType, productId] = id.split(':');
      const product = BUSINESS_TYPES[businessType]?.products.find((entry) => entry.id === productId);
      return `<span>${product?.name || productId} <b>×${count}</b></span>`;
    });
  $('acct-goods').innerHTML = goods.length
    ? `<b>Purchased goods</b><div>${goods.join('')}</div>`
    : '';
  $('acct-goods').classList.toggle('hidden', goods.length === 0);

  $('acct-wcount').textContent = `${state.linkedWallets.length} / ${MAX_LINKED_WALLETS}`;
  renderChainHistory();
  const wl = $('acct-wallets');
  wl.innerHTML = '';
  for (const w of state.linkedWallets) {
    const row = document.createElement('div');
    row.className = 'acct-wallet';
    const roles = Object.entries(ROLE_LABELS).map(([role, label]) =>
      `<button class="role-chip ${acc[role] === w.id ? 'on' : ''}" data-role="${role}" data-w="${w.id}">${label}</button>`
    ).join('');
    row.innerHTML = `
      ${walletLogo(walletBrandIcon(w.provider), w.provider, 'account-wallet-logo')}
      <span class="w-meta"><b>${shortAddr(w.address)}</b><small>${esc(w.provider)} · ${fmt(tokenMeta(w.address).tokenBalance)} ${TOKEN.name}${
        w.chainFamily === 'solana' ? ' · historical Solana wallet (read-only)' : ''
      }${tokenMeta(w.address).gasBalance ? ` · ${tokenMeta(w.address).gasBalance} ETH gas` : ''}</small></span>
      <span class="acct-roles">${roles}</span>
      ${state.linkedWallets.length > 1 ? `<button class="w-unlink" data-unlink="${w.id}" title="Unlink">✕</button>` : ''}`;
    wl.appendChild(row);
  }
  wl.querySelectorAll('.role-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sfx.click();
      const role = chip.dataset.role;
      if (role === 'withdrawalWallet') {
        // security delay after changing the withdrawal wallet (§13.3)
        state.account.withdrawalChangedAt = Date.now();
        toast('Withdrawal wallet changed — a short security cooldown applies', '', 3800);
      }
      state.account[role] = chip.dataset.w;
      save();
      renderAccount();
      refreshHud();
    });
  });
  wl.querySelectorAll('[data-unlink]').forEach((btn) => {
    btn.addEventListener('click', () => {
      sfx.click();
      if (unlinkWallet(btn.dataset.unlink)) {
        toast('Wallet unlinked — unlink cooldown applies before relinking');
        renderAccount();
        refreshHud();
      }
    });
  });
}

$('acct-add-wallet').addEventListener('click', () => {
  sfx.click();
  if (state.linkedWallets.length >= MAX_LINKED_WALLETS) {
    toast(`Wallet limit reached (${MAX_LINKED_WALLETS})`, 'err');
    return;
  }
  hidePanel('modal-account');
  openWalletModal('add');
});

$('acct-withdraw').addEventListener('click', () => { sfx.click(); hidePanel('modal-account'); openWithdraw(); });

$('acct-disconnect').addEventListener('click', () => {
  sfx.click();
  archiveCurrentAccount();
  hidePanel('modal-account');
  refreshHud();
  toast('Logged out — connect any verified linked wallet to return to this account');
});

// ── Funding (task4 §12 + inline §14) ─────────────────────────────────────────
let fundCtx = null;
let fundQuote = null;
let fundTimerId = null;
let activePaymentSession = null;

$('btn-fund').addEventListener('click', () => { sfx.click(); openFund(); });

function openFund(ctx = null) {
  if (!state.account) { openWalletModal('connect'); return; }
  if (!state.tokenConfig.flags.funding) { toast('Funding is currently disabled', 'err'); return; }
  fundCtx = ctx;
  fundQuote = null;
  $('fund-amount').value = ctx?.needed ? Math.max(1, Math.ceil(ctx.needed)) : '';
  $('fund-quote').classList.add('hidden');
  $('fund-steps').classList.add('hidden');
  document.querySelectorAll('#fund-steps li').forEach((li) => li.className = '');
  $('fund-go').disabled = false;
  $('fund-go').textContent = 'Get quote';
  $('fund-note').innerHTML = ctx?.needed
    ? `You are <b>${fmt(ctx.needed)}</b> coins short. Add funds and continue — your builder draft is saved and will not be lost.`
    : 'Game Coins are issued only after your Project Token deposit is confirmed. The price follows the live market — the quote below expires.';
  const renderWalletOptions = () => {
    const sel = $('fund-wallet');
    const selected = sel.value || state.account.paymentWallet;
    const symbol = chain.config()?.token?.tokenSymbol || TOKEN.name;
    // A historical Solana wallet is not a Robinhood Chain signing address
    // (task8 §19.2). It stays visible in the account panel but cannot pay.
    const usable = state.linkedWallets.filter((w) => w.chainFamily !== 'solana');
    sel.innerHTML = usable.map((w) =>
      `<option value="${w.id}" ${selected === w.id ? 'selected' : ''}>${shortAddr(w.address)} · ${esc(w.provider)} · ${fmt(tokenMeta(w.address).tokenBalance)} ${esc(symbol)}</option>`
    ).join('') || '<option value="">Link a Robinhood Chain wallet first</option>';
  };
  renderWalletOptions();
  showPanel('modal-fund');
  $('fund-state').textContent = '';
  renderFundChainBalances();
  refreshOnChainBalance(activeWallet('paymentWallet')).then(() => {
    renderWalletOptions();
    renderFundChainBalances();
  });
}

/**
 * Make sure the live wallet session matches the wallet the player selected and
 * is on the configured chain before anything is signed (task8 §9.4, §9.5).
 */
async function reconnectPaymentWallet(wallet) {
  if (!wallet || wallet.provider === 'demo') return null;
  const link = chain.currentLink();
  if (!link) throw new Error('Sign in with this wallet again before depositing.');
  const active = chain.walletAddress();
  if (active && active.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`The wallet is currently on ${shortAddr(active)} instead of ${shortAddr(wallet.address)}. Switch accounts in the wallet and try again.`);
  }
  if (!active) await chain.connect(wallet.provider);
  if (!await chain.ensureChain()) {
    throw new Error(`Switch your wallet to ${chain.network().networkName} before signing.`);
  }
  return chain;
}

/** Token balance, ETH gas balance and Game Coins are shown separately (§10). */
function renderFundChainBalances() {
  const host = $('fund-chain-balances');
  if (!host) return;
  const wallet = activeWallet('paymentWallet');
  const config = chain.config();
  const symbol = config?.token?.tokenSymbol || TOKEN.name;
  if (!wallet) { host.textContent = ''; return; }
  const meta = tokenMeta(wallet.address);
  host.innerHTML = wallet.provider === 'demo'
    ? `Demo wallet · ${fmt(meta.tokenBalance)} ${esc(symbol)} (offline test mode)`
    : `${esc(symbol)} balance: <b>${fmt(meta.tokenBalance)}</b> · ETH for gas: <b>${esc(meta.gasBalance ?? '—')}</b> · Network: <b>${esc(chain.network().networkName)}</b>`
      + (meta.gasWarning ? `<br><span style="color:var(--red)">${esc(meta.gasWarning)}</span>` : '');
}

function markFundingStep(steps, index, status) {
  const step = steps[index];
  if (!step) return;
  step.className = status;
}

async function cancelActivePaymentSession(reason = 'dialog-closed') {
  const session = activePaymentSession;
  activePaymentSession = null;
  if (!session || !state.account) return;
  await multiplayer.cancelPaymentSession({
    sessionId: session.sessionId,
    accountId: state.account.id,
    reason,
  });
}

document.querySelector('[data-close="modal-fund"]')?.addEventListener('click', () => {
  void cancelActivePaymentSession('dialog-closed');
});
addEventListener('pagehide', () => { void cancelActivePaymentSession('page-closed'); });

$('fund-amount').addEventListener('input', () => { fundQuote = null; $('fund-quote').classList.add('hidden'); $('fund-go').textContent = 'Get quote'; });
document.querySelectorAll('#modal-fund .conv-quick button').forEach((b) => {
  b.addEventListener('click', () => {
    sfx.click();
    $('fund-amount').value = b.dataset.amt;
    fundQuote = null; $('fund-quote').classList.add('hidden'); $('fund-go').textContent = 'Get quote';
  });
});

function renderQuoteBox(el, q, extra = '') {
  const left = Math.max(0, q.expiresAt - Date.now());
  const sec = Math.ceil(left / 1000);
  el.classList.remove('hidden');
  el.innerHTML = `
    ${q.kind === 'fund'
      ? `You pay <b>${fmt(q.tokens)} ${TOKEN.name}</b> → receive <b>${fmt(q.coins)}</b> ${gem}`
      : `You redeem <b>${fmt(q.coins)}</b> ${gem} → receive ≈ <b>${fmt(q.tokens)} ${TOKEN.name}</b>`}
    <br>Protected price: <b>${q.price.toFixed(5)}</b> · fee <b>${q.feePct}%</b>${q.impactPct ? ` · impact <b>${q.impactPct}%</b>` : ''}${q.slippagePct ? ` · max slippage <b>${q.slippagePct}%</b>` : ''}
    <br>Quote expires in <span class="quote-timer ${sec <= 10 ? 'low' : ''}">${sec}s</span>${extra}`;
  return left > 0;
}

function startQuoteTimer(el, getQuote, onExpire) {
  clearInterval(fundTimerId);
  fundTimerId = setInterval(() => {
    const q = getQuote();
    if (!q) { clearInterval(fundTimerId); return; }
    if (!renderQuoteBox(el, q)) {
      clearInterval(fundTimerId);
      onExpire();
    }
  }, 500);
}

$('fund-go').addEventListener('click', async () => {
  sfx.click();
  const amount = Math.floor(+$('fund-amount').value || 0);
  if (amount <= 0) { toast('Enter a Game Coin amount', 'err'); return; }
  if (!fundQuote || Date.now() > fundQuote.expiresAt) {
    fundQuote = quoteFunding(amount);
    renderQuoteBox($('fund-quote'), fundQuote);
    startQuoteTimer($('fund-quote'), () => fundQuote, () => {
      $('fund-go').textContent = 'Get quote';
      fundQuote = null;
    });
    $('fund-go').textContent = 'Confirm & sign';
    return;
  }
  const wallet = walletById($('fund-wallet').value);
  if (!wallet) { toast('Select a wallet', 'err'); return; }
  state.account.paymentWallet = wallet.id;
  save();
  $('fund-go').disabled = true;
  clearInterval(fundTimerId);
  const steps = [...document.querySelectorAll('#fund-steps li')];
  $('fund-steps').classList.remove('hidden');
  steps.forEach((step) => { step.className = ''; });
  let adapter = null;
  try {
    markFundingStep(steps, 0, 'active');
    activePaymentSession = await multiplayer.beginPaymentSession({
      accountId: state.account.id,
      walletAddress: wallet.address,
      quoteId: fundQuote.id,
      coins: fundQuote.coins,
      tokens: fundQuote.tokens,
    });
    markFundingStep(steps, 0, 'done');
    markFundingStep(steps, 1, 'active');
    adapter = await reconnectPaymentWallet(wallet);
    markFundingStep(steps, 1, 'done');
    markFundingStep(steps, 2, 'active');
  } catch (error) {
    await cancelActivePaymentSession(error?.message || 'wallet-connect-failed');
    const kind = walletErrorKind(error);
    const message = kind === 'wallet-busy'
      ? 'Another My Hood tab is using the wallet. Finish that request and try again.'
      : kind === 'extension-stale'
        ? 'The wallet extension was restarted. Reload this tab and try again.'
        : error?.message || 'Could not start a new payment session';
    toast(message, 'err', 6200);
    $('fund-go').disabled = false;
    $('fund-go').textContent = 'Get quote';
    fundQuote = null;
    return;
  }
  const res = await executeFunding(fundQuote, wallet, {
    // The browser only asks the wallet to sign. The deposit id, the required
    // amount, the approval plan and the credit decision all come from the
    // backend, which verifies the canonical event on Robinhood Chain.
    deposit: async ({ quote: activeQuote }) => {
      const prepared = await chain.quoteDeposit(activeQuote.coins);
      inFlightDepositId = prepared.quote.depositId;
      if (!prepared.sufficientToken) {
        throw new Error(`This wallet holds less than ${prepared.quote.displayTokenAmount} ${TOKEN.name} on ${chain.network().networkName}.`);
      }
      if (prepared.gasWarning) throw new Error(prepared.gasWarning);
      const outcome = await chain.runDeposit({
        quote: prepared.quote,
        approval: prepared.approval,
        onState: (label, detail) => {
          $('fund-state').textContent = detail?.finalityStatus
            ? `${label} · ${detail.finalityStatus.toLowerCase().replace('_', ' ')}`
            : label;
        },
      });
      if (!outcome.credited) {
        throw new Error(depositFailureMessage(outcome));
      }
      // The conversion service is fed the server-verified amount, not a
      // client-side estimate.
      activeQuote.coins = outcome.expectedGameCoins;
      activeQuote.tokens = Number(prepared.quote.displayTokenAmount);
      return { signature: `rhc:${prepared.quote.depositId}`, explorer: chain.explorerTx(outcome.transactionHash) };
    },
  });
  inFlightDepositId = null;
  if (res.error) {
    markFundingStep(steps, 2, 'error');
    await cancelActivePaymentSession(res.error);
    toast(res.error, 'err');
    $('fund-go').disabled = false;
    $('fund-go').textContent = 'Get quote';
    fundQuote = null;
    return;
  }
  for (let index = 2; index < steps.length; index += 1) markFundingStep(steps, index, 'done');
  const completedSession = activePaymentSession;
  activePaymentSession = null;
  if (completedSession) {
    await multiplayer.completePaymentSession({
      sessionId: completedSession.sessionId,
      accountId: state.account.id,
      signature: res.signature,
    }).catch(() => {});
  }
  sfx.coin();
  await refreshOnChainBalance(wallet);
  refreshHud();
  toast(`Received ${fmt(res.coins)} ${gem} · tx ${res.signature.slice(0, 10)}… confirmed`, 'ok', 4200);
  const ctx = fundCtx;
  setTimeout(() => {
    hidePanel('modal-fund');
    // inline builder funding (§14): return to the same step, same draft
    ctx?.onDone?.();
  }, 500);
});

/** Distinguish every failure class the player can act on (task8 §23). */
function depositFailureMessage(outcome) {
  const reasons = {
    'transaction-reverted': 'The deposit transaction was reverted on chain. Nothing was taken from your wallet balance beyond gas.',
    'deposit-event-missing': 'That transaction did not produce a deposit event for this game. Nothing was credited.',
    'event-amount-mismatch': 'The deposited amount does not match the quote. Support must reconcile this deposit manually.',
    'event-wallet-mismatch': 'The deposit was signed by a different wallet than the one linked to this quote.',
    'event-token-mismatch': 'That transaction moved a different token than the configured project token.',
    'wrong-deposit-contract': 'That transaction did not reach the configured deposit contract.',
    'quote-expired-before-submission': 'The quote had expired when the transaction was mined. Request a new quote.',
    'block-no-longer-canonical': 'The block containing your deposit was reorganized. Monitoring continues; nothing was credited yet.',
    'already-credited': 'This deposit was already credited.',
  };
  if (outcome.status === 'SOFT_CONFIRMED' || outcome.status === 'SAFE' || outcome.status === 'FINALIZED') {
    return 'Your transaction was received but has not reached the required settlement level yet. Game Coins appear automatically once it does.';
  }
  return reasons[outcome.reason] || 'The deposit could not be confirmed yet. It stays under monitoring; no coins were credited.';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Withdrawal (task4 §13) ───────────────────────────────────────────────────
let wdQuote = null;

function openWithdraw() {
  if (!state.account) return;
  if (!state.tokenConfig.flags.withdrawal) { toast('Withdrawals are currently disabled', 'err'); return; }
  wdQuote = null;
  $('wd-avail').textContent = fmt(availableCoins());
  $('wd-amount').value = '';
  $('wd-quote').classList.add('hidden');
  $('wd-go').textContent = 'Get quote';
  const w = activeWallet('withdrawalWallet');
  const cooldown = state.account.withdrawalChangedAt && Date.now() - state.account.withdrawalChangedAt < 60000;
  $('wd-wallet-note').innerHTML = w
    ? `Destination: verified wallet <b>${shortAddr(w.address)}</b> (${w.provider})${cooldown ? ' · <span style="color:var(--red)">security cooldown active</span>' : ''} · min ${state.tokenConfig.minWithdraw} coins`
    : 'No verified withdrawal wallet linked.';
  showPanel('modal-withdraw');
}

$('wd-amount').addEventListener('input', () => { wdQuote = null; $('wd-quote').classList.add('hidden'); $('wd-go').textContent = 'Get quote'; });

$('wd-go').addEventListener('click', async () => {
  sfx.click();
  const amount = Math.floor(+$('wd-amount').value || 0);
  if (amount <= 0) { toast('Enter an amount', 'err'); return; }
  const cooldown = state.account.withdrawalChangedAt && Date.now() - state.account.withdrawalChangedAt < 60000;
  if (cooldown) { toast('The withdrawal wallet was just changed — wait for the security cooldown', 'err'); return; }
  if (!wdQuote || Date.now() > wdQuote.expiresAt) {
    if (amount > availableCoins()) { toast('Not enough available coins', 'err'); return; }
    wdQuote = quoteWithdraw(amount);
    renderQuoteBox($('wd-quote'), wdQuote);
    startQuoteTimer($('wd-quote'), () => wdQuote, () => { $('wd-go').textContent = 'Get quote'; wdQuote = null; });
    $('wd-go').textContent = 'Confirm withdrawal';
    return;
  }
  clearInterval(fundTimerId);
  $('wd-go').disabled = true;
  $('wd-go').textContent = 'Sending…';
  const res = await executeWithdraw(wdQuote, {
    // Withdrawals are queued and signed by the backend worker; the browser
    // never holds or triggers a treasury key (task8 §13.3).
    payout: async ({ quote: activeQuote }) => {
      const result = await chain.requestWithdrawal({
        coins: activeQuote.coins,
        idempotencyKey: `wd_${activeQuote.id}`,
      });
      activeQuote.tokens = Number(result.displayTokenAmount);
      return {
        signature: `rhc:${result.withdrawalId}`,
        explorer: null,
        withdrawalId: result.withdrawalId,
        queued: true,
      };
    },
  });
  $('wd-go').disabled = false;
  if (res.error) { toast(res.error, 'err'); wdQuote = null; $('wd-go').textContent = 'Get quote'; return; }
  sfx.coin();
  await refreshOnChainBalance(res.wallet);
  refreshHud();
  toast(`${fmt(res.tokens)} ${TOKEN.name} queued for ${shortAddr(res.wallet.address)} on ${chain.network().networkName}. Watch its status and Blockscout link in your account panel.`, 'ok', 6000);
  hidePanel('modal-withdraw');
});

// ── Household budget (task4 §22) ─────────────────────────────────────────────
const CATEGORY_NAMES = { food: '🥨 Food', drinks: '☕ Drinks', flowers: '🌸 Flowers', books: '📚 Books', gadgets: '💾 Gadgets' };

function openBudget() {
  if (!state.account) return;
  renderBudget();
  showPanel('modal-budget');
}

function renderBudget() {
  const acc = state.account;
  const hh = householdOf(acc.id);
  $('bud-balance').textContent = fmt(balance(acct(acc.id, 'household')));
  $('bud-avail').textContent = fmt(availableCoins());
  $('bud-auto').checked = hh.autoSpend;
  $('bud-limit').value = hh.dailyLimit;
  $('bud-spent').textContent = `spent today: ${fmt(hh.spentToday)}`;
  $('bud-cats').innerHTML = Object.entries(CATEGORY_NAMES).map(([id, name]) =>
    `<button class="role-chip ${hh.categories[id] ? 'on' : ''}" data-cat="${id}">${name}</button>`
  ).join('');
  $('bud-cats').querySelectorAll('[data-cat]').forEach((b) => {
    b.addEventListener('click', () => {
      sfx.click();
      hh.categories[b.dataset.cat] = !hh.categories[b.dataset.cat];
      save();
      renderBudget();
    });
  });
  const history = state.orders
    .filter((o) => o.buyer === acc.id && o.buyerClass === 'household')
    .slice(-12).reverse();
  $('bud-history').innerHTML = history.length
    ? history.map((o) => `<div>· ${o.product} — ${fmt(o.gross)} ${o.status === 'refunded' ? '(refunded)' : ''}</div>`).join('')
    : '<div>No resident purchases yet.</div>';
}

$('bud-fund').addEventListener('click', () => {
  sfx.click();
  const amount = Math.floor(+$('bud-amount').value || 0);
  if (amount <= 0) return;
  if (!fundHousehold(state.account.id, amount)) { toast('Not enough available coins', 'err'); return; }
  refreshHud();
  renderBudget();
});
$('bud-return').addEventListener('click', () => {
  sfx.click();
  const amount = Math.floor(+$('bud-amount').value || 0);
  if (amount <= 0) return;
  if (!returnHousehold(state.account.id, amount)) { toast('The household budget has less than that', 'err'); return; }
  refreshHud();
  renderBudget();
});
$('bud-auto').addEventListener('change', () => {
  const hh = householdOf(state.account.id);
  hh.autoSpend = $('bud-auto').checked;
  save();
  toast(hh.autoSpend ? 'Residents may now buy within the budget' : 'Automatic spending turned off');
});
$('bud-limit').addEventListener('change', () => {
  const hh = householdOf(state.account.id);
  hh.dailyLimit = Math.max(0, Math.floor(+$('bud-limit').value || 0));
  save();
});

// ── Business (task4 §19–20) ──────────────────────────────────────────────────
function mkBusiness(type) {
  const t = BUSINESS_TYPES[type];
  const prices = {}, stock = {};
  for (const p of t.products) { prices[p.id] = p.price; stock[p.id] = 0; }
  return { type, level: 1, reputation: 0, stock, prices, status: 'open', visitors: 0, uniq: {} };
}

const businessActions = new Set();

async function commitBusinessState(houseId, nextBusiness, {
  cost = 0,
  reason = 'Business update',
  operation = { action: 'create' },
} = {}) {
  const house = state.houses.find((candidate) => candidate.id === houseId);
  if (!house || !state.account || house.owner !== state.account.id) return false;
  if (businessActions.has(houseId)) {
    toast('The previous business change is still being saved', 'err');
    return false;
  }
  if (!multiplayer.isOnline()) {
    toast('The shared city is reconnecting. Try again in a moment.', 'err');
    return false;
  }

  const previous = jsonCopy(state.businesses[houseId], null);
  try { await ensureFamilySession(true); } catch (error) { toast(error.message, 'err'); return false; }
  const spend = cost > 0 ? storeSpend(house.owner, cost, reason) : null;
  if (cost > 0 && !spend) {
    toast('Not enough coins for this purchase', 'err');
    return false;
  }
  businessActions.add(houseId);
  state.businesses[houseId] = jsonCopy(nextBusiness);
  save();
  refreshHud();
  try {
    const result = await multiplayer.changeBusiness({
      accountId: house.owner,
      houseId,
      business: nextBusiness,
      ...operation,
    });
    if (!result?.document) throw new Error('invalid-business-response');
    if (!result.applied) {
      if (spend?.opId) {
        reverseOperation(spend.opId, result.reason || 'business-not-applied', `reverse_${spend.opId}`);
      }
      applyRemoteHouse(result.document);
      toast('This house already has a business. Its current state is shown.', 'err', 4200);
      return false;
    }
    applyRemoteHouse(result.document);
    return true;
  } catch (error) {
    if (spend?.opId) {
      reverseOperation(spend.opId, error?.message || 'business-sync-failed', `reverse_${spend.opId}`);
    }
    if (error?.document) applyRemoteHouse(error.document);
    else if (previous) state.businesses[houseId] = previous;
    else delete state.businesses[houseId];
    save();
    refreshHud();
    const reasons = {
      'multiplayer-offline': 'The shared city disconnected. Your coins were returned.',
      'multiplayer-timeout': 'The shared city did not confirm the change. Your coins were returned.',
      'not-business-owner': 'Only the owner can change this business.',
    };
    toast(reasons[error?.message] || 'The business change was not saved. Your coins were returned.', 'err', 5200);
    return false;
  } finally {
    businessActions.delete(houseId);
  }
}

function openBizBuy(houseId) {
  if (!requireWallet()) return;
  const cfg = state.houses.find((h) => h.id === houseId);
  if (!cfg) return;
  const list = $('bizbuy-list');
  list.innerHTML = '';
  for (const typeId of BUSINESS_BY_MATERIAL[cfg.material] || []) {
    const t = BUSINESS_TYPES[typeId];
    const card = document.createElement('button');
    card.className = 'companion-card';
    card.innerHTML = `
      <div class="comp-emoji">${t.emoji}</div><b>${t.name}</b>
      <small>${t.products.map((p) => p.name).join(' · ')}</small>
      <small style="margin-top:5px"><b>${fmt(BUSINESS_COST)}</b> coins</small>`;
    card.addEventListener('click', async () => {
      sfx.click();
      const created = await commitBusinessState(houseId, mkBusiness(typeId), {
        cost: BUSINESS_COST,
        reason: `Business: ${t.name}`,
        operation: { action: 'create' },
      });
      if (!created) return;
      hidePanel('modal-bizbuy');
      const comp = city.addBusinessBuilding(houseId, typeId, t, { animate: true });
      if (comp) {
        playBuildAnimation(comp.parts, { onPart: (o) => sfx.pop(o), onDone: () => sfx.chime() });
      }
      refreshHud();
      toast(`${t.name} opened! Stock it up so residents can shop here`, 'ok', 4500);
      selectHouse(houseId);
      setTimeout(() => openBizManage(houseId), 900);
    });
    list.appendChild(card);
  }
  showPanel('modal-bizbuy');
}

function openBizManage(houseId) {
  const biz = state.businesses[houseId];
  const cfg = state.houses.find((h) => h.id === houseId);
  if (!biz || !cfg) return;
  const t = BUSINESS_TYPES[biz.type];
  $('biz-title').innerHTML = `${t.emoji} ${t.name} <small class="muted-inline">Lv ${biz.level}</small>`;
  const stats = sellerStats(cfg.owner);
  $('biz-stats').innerHTML = [
    ['Reputation', biz.reputation],
    ['Visitors', biz.visitors || 0],
    ['Households', Object.keys(biz.uniq || {}).length],
    ['Gross sales', stats.gross],
    ['Fees paid', stats.fees],
    ['Refunds', stats.refunds],
    ['Pending', stats.pending],
    ['Available', stats.available],
    ['Withdrawn', stats.withdrawn],
  ].map(([n, v]) => `<div class="acct-bal">${n}<b>${fmt(v)}</b></div>`).join('');

  const box = $('biz-products');
  box.innerHTML = '';
  for (const p of t.products) {
    const price = biz.prices[p.id];
    const [lo, hi] = [Math.max(1, Math.round(p.price * MARKET.priceBand[0])), Math.round(p.price * MARKET.priceBand[1])];
    const row = document.createElement('div');
    row.className = 'biz-prod';
    row.innerHTML = `
      <span class="bp-name">${p.name}<small>restores ${NEEDS[p.need].icon} ${NEEDS[p.need].name} +${p.restore}</small></span>
      <span>×${biz.stock[p.id] || 0}</span>
      <button class="mini-btn" data-restock="${p.id}" title="Restock ×${MARKET.restockBatch} for ${fmt(p.cost * MARKET.restockBatch)}">+${MARKET.restockBatch} (${fmt(p.cost * MARKET.restockBatch)})</button>
      <button class="mini-btn" data-pdown="${p.id}">−</button>
      <b>${fmt(price)}</b>
      <button class="mini-btn" data-pup="${p.id}">+</button>`;
    box.appendChild(row);
    row.querySelector('[data-restock]').addEventListener('click', async () => {
      sfx.click();
      const cost = p.cost * MARKET.restockBatch;
      const next = jsonCopy(biz);
      next.stock[p.id] = (next.stock[p.id] || 0) + MARKET.restockBatch;
      await commitBusinessState(houseId, next, {
        cost,
        reason: `Restock: ${p.name}`,
        operation: { action: 'restock', productId: p.id, amount: MARKET.restockBatch },
      });
      openBizManage(houseId);
    });
    row.querySelector('[data-pdown]').addEventListener('click', async () => {
      sfx.click();
      // price bands are enforced (§20.4) — no dumping, no gouging
      const next = jsonCopy(biz);
      next.prices[p.id] = Math.max(lo, price - 1);
      await commitBusinessState(houseId, next, {
        reason: `Price: ${p.name}`,
        operation: { action: 'price', productId: p.id, value: next.prices[p.id] },
      });
      openBizManage(houseId);
    });
    row.querySelector('[data-pup]').addEventListener('click', async () => {
      sfx.click();
      const next = jsonCopy(biz);
      next.prices[p.id] = Math.min(hi, price + 1);
      await commitBusinessState(houseId, next, {
        reason: `Price: ${p.name}`,
        operation: { action: 'price', productId: p.id, value: next.prices[p.id] },
      });
      openBizManage(houseId);
    });
  }
  $('biz-toggle').textContent = biz.status === 'open' ? 'Close temporarily' : 'Reopen';
  $('biz-toggle').onclick = async () => {
    sfx.click();
    const next = jsonCopy(biz);
    next.status = next.status === 'open' ? 'closed' : 'open';
    await commitBusinessState(houseId, next, {
      reason: 'Business status',
      operation: { action: 'status', value: next.status },
    });
    openBizManage(houseId);
  };
  showPanel('modal-bizmanage');
}

/** Player-to-player storefront. Inventory and buyer coins are reserved by
 * createOrder in one commit; delivery moves only those existing coins. */
function openMarketplace(houseId) {
  const business = state.businesses[houseId];
  const sellerHouse = state.houses.find((house) => house.id === houseId);
  if (!business || !sellerHouse) return;
  if (!state.account) { openWalletModal('connect'); return; }
  if (sellerHouse.owner === state.account.id) { openBizManage(houseId); return; }
  const type = BUSINESS_TYPES[business.type];
  $('market-title').textContent = `${type.emoji} ${type.name} · ${sellerHouse.name}`;
  $('market-note').textContent = business.status === 'open'
    ? 'Buy supplies to use at home, or book a family visit. Review coverage and recovery before paying.'
    : 'This business is temporarily closed.';
  const box = $('market-products');
  box.innerHTML = '';
  for (const product of type.products) {
    const price = business.prices[product.id] ?? product.price;
    const stock = business.stock[product.id] || 0;
    const row = document.createElement('div');
    row.className = 'biz-prod market-prod';
    const effect = Object.entries(product.effects || {}).map(([key, amount]) => `${FAMILY_NEEDS[key].icon} ${FAMILY_NEEDS[key].name} +${amount}`).join(' · ');
    row.innerHTML = `<span class="bp-name">${esc(product.name)}<small>${effect}</small><small>Covers ${product.coveredResidents} · consumes ${product.stockUnits} ${product.delivery === 'service' ? 'capacity' : 'stock'} unit(s)</small></span>
      <span>${product.delivery === 'service' ? 'Capacity' : 'Stock'} ×${stock}</span>
      <span><b>${fmt(price)}</b> ${gem}</span><button class="btn btn-primary" ${business.status !== 'open' || stock < product.stockUnits ? 'disabled' : ''}>Review</button>
      <small class="offer-reason"></small>`;
    const buy = row.querySelector('button');
    buy.onclick = async () => {
      buy.disabled = true;
      try {
        await ensureFamilySession(true);
        const quote = await familyClient.quote(houseId, product.id);
        if (!quote.allowed) throw new Error(quote.reason);
        const key = 'purchase_' + crypto.randomUUID();
        let orderId = null;
        reviewAction({
          title: product.name,
          body: effectsMarkup(familyClient.state, quote.product, quote)
            + `<p><b>${fmt(quote.price)} Game Coins</b> · Stock/capacity ${quote.stock} · Uses ${quote.stockUnits} unit(s)</p>`
            + (quote.storageLimit ? `<p>Storage after purchase: ${quote.storageUsed + (['books','flowers'].includes(product.storageCategory) ? 1 : product.stockUnits)}/${quote.storageLimit}</p>` : ''),
          label: 'Confirm purchase',
          onConfirm: async () => {
            if (!multiplayer.isOnline()) throw new Error('The shared city is reconnecting. Try again shortly.');
            const feePct = state.tokenConfig?.marketplaceFeePct ?? MARKET.feePct;
            const fee = Math.max(1, Math.round(quote.price * feePct / 100));
            if (!orderId) {
              const result = createOrder({ buyer: state.account.id, seller: sellerHouse.owner, gross: quote.price, fee,
                businessId: houseId, product: product.id, key });
              if (result.error) throw new Error(result.error === 'insufficient' ? 'Not enough available Game Coins.' : result.error);
              orderId = result.order.id;
            }
            let shared;
            try {
              shared = await multiplayer.purchaseProduct({ buyerId: state.account.id, householdId: familyClient.houseId,
                houseId, productId: product.id, purchaseKey: key, expectedPrice: quote.price, fee });
            } catch (error) {
              // A lost connection is ambiguous: keep the same reserved order/key
              // for retry instead of refunding a potentially completed sale.
              if (error.message === 'multiplayer-timeout') throw new Error('Confirmation is delayed. Retry here; the same order will not charge twice.');
              failOrder(orderId, error.message);
              orderId = null;
              throw error;
            }
            attachSharedTrade(orderId, { ...shared.trade, id: shared.trade._id || shared.trade.id });
            if (!deliverOrder(orderId)) throw new Error('Delivery settlement is pending. Please retry this same order.');
            applyRemoteHouse(shared.document);
            await familyClient.refresh();
            refreshHud();
            sfx.coin();
            toast(product.delivery === 'service' ? 'Family visit started. Complete it in Family & supplies.' : 'Delivered to Family & supplies. Use it there to recover.', 'ok', 5500);
            openMarketplace(houseId);
          },
        });
      } catch (error) { row.querySelector('.offer-reason').textContent = error.message; }
      finally { buy.disabled = false; }
    };
    box.appendChild(row);
  }
  showPanel('modal-marketplace');
}

// ── Builder: structured house flow (task5 §6) ────────────────────────────────
const BUILD_STEPS = [
  { title: 'Step 1 · Foundation' },
  { title: 'Step 2 · Floors' },
  { title: 'Step 3 · Floor Layout' },
  { title: 'Step 4 · Structural Material' },
  { title: 'Step 5 · Roof' },
  { title: 'Step 6 · Doors & Windows' },
  { title: 'Step 7 · Signature Detail' },
  { title: 'Step 8 · Validate & Build' },
];
let buildStep = 0;
let draft = null;

function newDraft() {
  return {
    foundation: 'compact', height: 'one', floorCount: 1, layout: 'balanced', material: 'wood', roof: 'gable',
    kit: 'cozy', detail: 'none', scheme: 'light', name: '', nickname: '',
  };
}

$('btn-build').addEventListener('click', () => {
  sfx.click();
  // The wallet is the login: no wallet, no building.
  if (!requireWallet()) return;
  const mine = state.houses.filter((h) => h.owner === state.account.id);
  // A player may own a second house, but only after the first reaches its
  // full five completed floors (matches the server rule).
  if (mine.length >= 2) {
    toast('You already own two houses — the maximum per account', 'err');
    $('btn-find').click();
    return;
  }
  if (mine.length === 1) {
    const first = mine[0];
    const floors = first.completedFloorCount ?? floorCountFor(first);
    const building = first.construction?.status === 'building';
    if (floors < 5 || building) {
      toast('Finish all 5 floors of your first house before building a second one', 'err', 5500);
      $('btn-find').click();
      return;
    }
  }
  draft = draft || state.builderDraft || newDraft();
  draft.layout ||= 'balanced';
  draft.floorCount = floorCountFor(draft);
  draft.height = 'one';
  buildStep = 0;
  setMode('builder');
  sfx.whoosh();
  renderBuilderStep();
  refreshPreview(true);
});

$('builder-exit').addEventListener('click', () => {
  sfx.click();
  state.builderDraft = draft; // draft survives leaving and funding trips (§14)
  save();
  setMode('city');
  toast('Draft saved — come back any time');
});

$('builder-prev').addEventListener('click', () => {
  sfx.click();
  if (buildStep > 0) { buildStep--; renderBuilderStep(); }
});

$('builder-next').addEventListener('click', () => {
  sfx.click();
  if (buildStep < BUILD_STEPS.length - 1) { buildStep++; renderBuilderStep(); }
  else confirmBuild();
});

$('builder-daynight').addEventListener('click', () => {
  sfx.click();
  previewNight = !previewNight;
  $('builder-daynight').innerHTML = icon(previewNight ? 'sun' : 'moon');
  applyPreviewLighting();
});

function applyPreviewLighting() {
  if (previewNight) {
    previewScene.background.set('#303e68');
    previewScene.fog.color.set('#303e68');
    previewHemi.intensity = 0.55;
    previewSun.intensity = 0.45;
    previewSun.color.set('#91a7ff');
  } else {
    previewScene.background.set('#8ed9ef');
    previewScene.fog.color.set('#8ed9ef');
    previewHemi.intensity = 1.08;
    previewSun.intensity = 1.65;
    previewSun.color.set('#ffe5ad');
  }
  if (previewHouse) {
    for (const m of previewHouse.winMats) m.emissiveIntensity = previewNight ? 0.95 : 0.08;
    for (const m of previewHouse.signMats) m.emissiveIntensity = previewNight ? 1.5 : 0.5;
  }
}

function renderBuilderStep() {
  $('builder-title').textContent = BUILD_STEPS[buildStep].title;
  $('builder-prev').style.visibility = buildStep === 0 ? 'hidden' : 'visible';
  $('builder-next').innerHTML = buildStep === BUILD_STEPS.length - 1
    ? `${icon('hammer')} Build It!`
    : `Next ${icon('right')}`;

  const stepsEl = $('builder-steps');
  stepsEl.innerHTML = '';
  BUILD_STEPS.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'builder-step' + (i === buildStep ? ' active' : i < buildStep ? ' done' : '');
    d.innerHTML = i < buildStep ? icon('check') : String(i + 1);
    d.addEventListener('click', () => { if (i <= buildStep) { buildStep = i; renderBuilderStep(); } });
    stepsEl.appendChild(d);
  });

  const box = $('builder-options');
  box.innerHTML = '';
  const lvl = userLevel().level;

  const optCard = (opt, selected, onPick, { lockReason = null } = {}) => {
    const locked = opt.level > lvl || lockReason;
    const b = document.createElement('button');
    b.className = 'opt-card' + (selected ? ' sel' : '') + (locked ? ' locked' : '');
    b.innerHTML = `<div class="opt-name">${opt.name}</div>
      <div class="opt-desc">${opt.desc || ''}</div>
      ${locked
        ? `<div class="opt-lock">${icon('lock')} ${lockReason || 'Level ' + opt.level + ' needed'}</div>`
        : `<div class="opt-cost">${opt.cost > 0 ? '+' + fmt(opt.cost) + ' ' + gem : 'free'}</div>`}`;
    b.addEventListener('click', () => {
      if (locked) {
        sfx.error();
        toast(lockReason || `Unlocks at level ${opt.level} — fund more Game Coins`, 'err');
        return;
      }
      sfx.click();
      onPick();
      state.builderDraft = draft;
      renderBuilderStep();
      refreshPreview();
    });
    box.appendChild(b);
    return b;
  };

  if (buildStep === 0) {
    FOUNDATIONS.forEach((o) => optCard(o, draft.foundation === o.id, () => { draft.foundation = o.id; }));
  } else if (buildStep === 1) {
    const floors = floorCountFor(draft);
    const definition = buildHouseDefinition(draft);
    const panel = document.createElement('div');
    panel.className = 'floor-count-step';
    panel.innerHTML = `<h3>Number of floors</h3><div class="floor-stepper">
      <button id="floor-minus" class="btn btn-ghost" aria-label="Remove one floor" ${floors === 1 ? 'disabled' : ''}>−</button>
      <output id="floor-count" aria-live="polite">${floors}</output>
      <button id="floor-plus" class="btn btn-primary" aria-label="Add one floor" ${floors === MAX_FLOORS ? 'disabled' : ''}>+</button>
      </div><div class="floor-facts"><span>Residents <b>${residentsFor(draft)}</b></span>
      <span>Family units <b>${familyConsumptionFor(draft)}</b></span><span>Cost <b>${fmt(houseCost(draft))} coins</b></span>
      <span>Construction <b>${constructionSecondsFor(draft)}s</b></span><span>Sleeping capacity <b>${residentsFor(draft)}</b></span>
      <span>Editable floors <b>${floors}</b></span></div>
      <div class="floor-room-preview">${definition.floors.map((floor, index) => `<p><b>${index ? 'Floor ' + (index + 1) : 'Ground Floor'}</b> · ${floor.rooms.map((room) => room.name || room.roomType || room.type).join(' / ')}</p>`).join('')}</div>`;
    box.appendChild(panel);
    const change = (delta) => {
      draft.floorCount = Math.max(1, Math.min(MAX_FLOORS, floors + delta));
      if (draft.detail === 'balcony' && draft.floorCount === 1) draft.detail = 'none';
      state.builderDraft = draft; save(); renderBuilderStep(); refreshPreview(true);
    };
    $('floor-minus').onclick = () => change(-1);
    $('floor-plus').onclick = () => change(1);
  } else if (buildStep === 2) {
    HOUSE_LAYOUTS.forEach((o) => optCard(o, draft.layout === o.id, () => { draft.layout = o.id; }));
  } else if (buildStep === 3) {
    MATERIALS.forEach((o) => optCard(o, draft.material === o.id, () => {
      draft.material = o.id;
      draft.scheme = o.schemes[0].id;
    }));
  } else if (buildStep === 4) {
    ROOFS.forEach((o) => optCard(o, draft.roof === o.id, () => {
      draft.roof = o.id;
      if (o.id === 'gable' && draft.detail === 'solar') draft.detail = 'none';
    }, {
      lockReason: o.id === 'flat' && draft.height === 'attic' ? 'The attic needs a pitched roof' : null,
    }));
  } else if (buildStep === 5) {
    KITS.forEach((o) => optCard(o, draft.kit === o.id, () => { draft.kit = o.id; }));
  } else if (buildStep === 6) {
    optCard({ id: 'none', name: 'None', desc: 'Keep the silhouette clean', cost: 0, level: 1 },
      draft.detail === 'none', () => { draft.detail = 'none'; });
    DETAILS.forEach((o) => {
      let lockReason = null;
      if (!detailAllowed(o.id, draft)) {
        lockReason = o.id === 'solar' ? 'Needs a flat or shed roof' : 'Needs more than one floor';
      }
      optCard(o, draft.detail === o.id, () => { draft.detail = o.id; }, { lockReason });
    });
  } else {
    const material = MATERIALS.find((m) => m.id === draft.material);
    for (const s of material.schemes) {
      const b = document.createElement('button');
      b.className = 'opt-card scheme-card' + (draft.scheme === s.id ? ' sel' : '');
      b.innerHTML = `<div class="opt-name">${s.name}</div>
        <div class="scheme-swatches">
          <i style="background:${s.wall}"></i><i style="background:${s.trim}"></i>
          <i style="background:${s.roof}"></i><i style="background:${s.accent}"></i>
        </div>`;
      b.addEventListener('click', () => { sfx.click(); draft.scheme = s.id; renderBuilderStep(); refreshPreview(); });
      box.appendChild(b);
    }
    const coins = availableCoins();
    const cost = houseCost(draft);
    const shortfall = Math.max(0, cost - coins);
    const layout = HOUSE_LAYOUTS.find((x) => x.id === draft.layout);
    const bizOptions = (BUSINESS_BY_MATERIAL[draft.material] || []).map((t) => BUSINESS_TYPES[t].name).join(' or ');
    const wrap = document.createElement('div');
    wrap.className = 'builder-inputs';
    wrap.style.cssText = 'flex:1;min-width:min(430px,80vw)';
    wrap.innerHTML = `
      <input id="in-name" maxlength="20" placeholder="House name (3–20 characters)" value="${esc(draft.name)}" />
      <input id="in-nick" maxlength="16" placeholder="Your nickname (2–16 characters)" value="${esc(draft.nickname)}" />
      <div class="input-err" id="name-err"></div>
      <div class="build-summary">
        Cost <b>${fmt(cost)}</b> ${gem} (you have <b>${fmt(coins)}</b> ${gem}) ·
        Plan: <b>${layout?.name || 'Balanced'}</b> ·
        Floors: <b>${floorCountFor(draft)}</b> · Residents: <b>${residentsFor(draft)}</b> · Family units: <b>${familyConsumptionFor(draft)}</b> · Construction: <b>${constructionSecondsFor(draft)}s</b> ·
        Business plot reserved next door: <b>${bizOptions}</b> — purchased separately<br>
        Owned by your account · flip ${icon('moon')} above to preview the evening look
        ${shortfall > 0 ? `<br><span style="color:var(--red)">You are ${fmt(shortfall)} ${gem} short.</span>` : ''}
      </div>
      ${shortfall > 0 ? `<button id="builder-fund" class="btn btn-primary" style="align-self:flex-start">${icon('swap')} Add funds and continue</button>` : ''}`;
    box.appendChild(wrap);
    $('in-name').addEventListener('input', (e) => { draft.name = e.target.value; state.builderDraft = draft; validateName(); });
    $('in-nick').addEventListener('input', (e) => { draft.nickname = e.target.value; state.builderDraft = draft; validateName(); });
    $('builder-fund')?.addEventListener('click', () => {
      sfx.click();
      state.builderDraft = draft;
      save();
      // funding opens as an overlay — the builder stays underneath (§14)
      openFund({ context: 'builder', needed: shortfall, onDone: () => { renderBuilderStep(); } });
    });
    validateName();
  }
  $('builder-total').textContent = fmt(houseCost(draft));
}

function esc(s) { return escapeHtml(s); }

function validateName() {
  const err = $('name-err');
  if (!err) return false;
  const name = draft.name.trim();
  const nick = draft.nickname.trim();
  let msg = '';
  if (name.length > 0 && name.length < 3) msg = 'The name is too short';
  else if (name && !/^[\p{L}\p{N}\s\-_.]+$/u.test(name)) msg = 'The name contains invalid characters';
  else if (name && nameTaken(name)) msg = 'This name is already taken';
  else if (nick.length > 0 && nick.length < 2) msg = 'The nickname is too short';
  err.textContent = msg;
  return !msg && name.length >= 3 && nick.length >= 2;
}

function refreshPreview(reset = false) {
  if (previewHouse) previewScene.remove(previewHouse.group);
  previewHouse = createHouse({ ...draft, name: draft.name || 'Your House', nickname: draft.nickname || 'you' });
  previewScene.add(previewHouse.group);
  if (reset) {
    const floors = floorCountFor(draft);
    const centerY = 1.2 + floors * 1.35;
    previewCam.position.set(11 + floors, centerY + 5, 11 + floors);
    previewControls.target.set(0, centerY, 0);
    previewControls.maxDistance = 30 + floors * 3;
  }
  applyPreviewLighting();
  previewHouse.group.scale.setScalar(0.94);
  tween({
    duration: 420, ease: Ease.outBack,
    onUpdate: (k) => previewHouse && previewHouse.group.scale.setScalar(0.94 + 0.06 * k),
  });
}

// ── Confirm → placement (no auto-business, task4 §19.1) ──────────────────────
async function confirmBuild() {
  if (!validateName()) { sfx.error(); toast('Fill in the name and nickname', 'err'); return; }
  const cost = houseCost(draft);
  const coins = availableCoins();
  if (coins < cost) {
    sfx.error();
    state.builderDraft = draft;
    save();
    openFund({ context: 'builder', needed: cost - coins, onDone: () => renderBuilderStep() });
    return;
  }
  placeHouse();
}

async function placeHouse() {
  const cost = houseCost(draft);
  try { await ensureFamilyAccess(true); } catch (error) { toast(error.message, 'err'); return; }
  if (!multiplayer.isOnline()) {
    toast('The shared city is reconnecting. Please wait a moment before building.', 'err', 5600);
    return;
  }

  const cfg = {
    id: (import.meta.env.DEV && new URLSearchParams(location.search).get('qa') === '1' ? 'verify_ui_' : 'h_') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    owner: state.account.id,
    name: draft.name.trim(),
    nickname: draft.nickname.trim(),
    foundation: draft.foundation, height: 'one', floorCount: floorCountFor(draft), material: draft.material,
    layout: draft.layout || 'balanced',
    roof: draft.roof, kit: draft.kit, detail: draft.detail, scheme: draft.scheme,
    companion: null, // the business plot stays reserved until purchased
    builtAt: Date.now(),
  };
  cfg.schemaVersion = SCHEMA_VERSION;
  cfg.revision = 0;
  let plot = city.pickPlot(cfg, state.houses);
  if (!plot) { toast('The town has no free plots at this stage', 'err'); return; }
  const spendRes = storeSpend(state.account.id, cost, `Build: ${cfg.name}`, `build_${cfg.id}`);
  if (!spendRes) { toast('Payment failed — nothing was charged', 'err'); return; }

  let canonicalDocument = null;
  let buildError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    cfg.plot = { i: plot.i, x: round2(plot.x), z: round2(plot.z) };
    const definition = buildHouseDefinition(cfg);
    try {
      canonicalDocument = await multiplayer.createHouse(publicHouseDocument(cfg, {
        definition,
        interior: { slots: {}, yard: {} },
        placements: { revision: 0, objects: defaultResidentialObjects(definition) },
        business: null,
        needs: null,
        links: [],
      }));
      break;
    } catch (error) {
      buildError = error;
      if (error.message !== 'plot-taken') break;
      try { await multiplayer.requestSnapshot(); } catch { break; }
      plot = city.pickPlot(cfg, state.houses);
      if (!plot) break;
    }
  }
  if (!canonicalDocument) {
    reverseOperation(spendRes.opId, buildError?.message || 'multiplayer-build-failed', `reverse_${cfg.id}`);
    const reasons = {
      'name-taken': 'This house name was just taken by another player',
      'plot-taken': 'All suitable plots were taken by other players',
      'multiplayer-offline': 'The shared city disconnected before the house was saved',
      'multiplayer-timeout': 'The shared city did not confirm the house in time',
    };
    toast(`${reasons[buildError?.message] || 'The multiplayer server rejected the house'}. Your coins were returned.`, 'err', 6200);
    refreshHud();
    return;
  }

  const canonicalCfg = assignPublicHouseDocument(canonicalDocument);
  if (!canonicalCfg) {
    reverseOperation(spendRes.opId, 'invalid-canonical-house', `reverse_${cfg.id}`);
    toast('The multiplayer server returned an invalid house. Your coins were returned.', 'err', 6000);
    return;
  }
  draft = null;
  state.builderDraft = null;
  save();
  refreshHud();
  const paymentWallet = activeWallet('paymentWallet');
  if (paymentWallet && paymentWallet.provider !== 'demo') refreshOnChainBalance(paymentWallet);
  setMode('city');
  sfx.whoosh();

  const rec = reconcileHouseScene(canonicalCfg);
  rec.serverClock = { at: canonicalDocument.serverTimestamp || canonicalDocument.updatedAt, received: performance.now() };
  city.flyTo(new THREE.Vector3(canonicalCfg.plot.x, 0, canonicalCfg.plot.z), { distance: 26, height: 16, duration: 1500 });
  selectHouse(canonicalCfg.id);
  toast('Construction started. Your family moves in when the server confirms completion.', 'ok', 5500);
}

const round2 = (n) => Math.round(n * 100) / 100;

// ── Links helpers ────────────────────────────────────────────────────────────
function allLinksOf(houseId) {
  const own = state.links[houseId] || [];
  const incoming = [];
  for (const [otherId, links] of Object.entries(state.links)) {
    if (otherId === houseId) continue;
    for (const l of links) {
      if (l.to === houseId && !own.some((o) => o.to === otherId) &&
          !incoming.some((o) => o.to === otherId)) {
        incoming.push({ ...l, to: otherId });
      }
    }
  }
  return [...own, ...incoming];
}

function maybeFormSocialLink(fromId, toId) {
  const v = (state.visits[fromId]?.[toId] || 0) + (state.visits[toId]?.[fromId] || 0);
  if (v < 3) return;
  const links = state.links[fromId] || (state.links[fromId] = []);
  if (links.some((l) => l.to === toId)) return;
  links.push({ to: toId, type: 'social', strength: Math.min(1, v / 8), reason: 'Residents visit each other regularly' });
  save();
  sfx.chime();
  const p = residents.people.find((x) => x.houseId === fromId && x.mesh.visible);
  if (p) bubbles.eventLine(p, 'newlink');
}

// ── House card & selection ───────────────────────────────────────────────────
function selectHouse(id) {
  selectedHouseId = id;
  const cfg = state.houses.find((h) => h.id === id);
  if (!cfg) return;

  $('hc-name').textContent = cfg.name;
  $('hc-nick').textContent = '@' + cfg.nickname;
  const isOwner = state.account && cfg.owner === state.account.id;
  const material = MATERIALS.find((m) => m.id === cfg.material);
  const form = `${FOUNDATIONS.find((f) => f.id === cfg.foundation)?.name || '—'} · ${floorCountFor(cfg)} floor(s)`;
  const plotInfo = city.plots[cfg.plot?.i];
  const biz = state.businesses[id];
  const bizName = biz ? `${BUSINESS_TYPES[biz.type].emoji} ${BUSINESS_TYPES[biz.type].name} · Lv ${biz.level}` : 'plot for sale';
  const rows = [
    ['Owner', isOwner ? 'You' : shortAddr(cfg.owner)],
    ['Material', material?.name || '—'],
    ['Form', form],
    ['Residents', String(completedResidents(cfg))],
    ['Family units', String(familyConsumptionFor(cfg))],
    ['Business', bizName],
    ['District', plotInfo?.district || '—'],
    ['Connections', String(allLinksOf(cfg.id).length)],
  ];
  $('hc-rows').innerHTML = rows.map(([k, v]) => `<div class="hc-row"><span>${k}</span><b>${v}</b></div>`).join('');
  renderNeeds();

  $('hc-business').classList.toggle('hidden', !isOwner && !biz);
  $('hc-business').innerHTML = isOwner
    ? (biz ? '🏪 Manage Business' : '🏪 Buy Business')
    : `🛍 Shop at ${biz ? BUSINESS_TYPES[biz.type].name : 'Business'}`;
  $('hc-budget').classList.toggle('hidden', !isOwner);
  $('hc-budget').innerHTML = `🏡 Household Budget`;
  $('hc-family').classList.toggle('hidden', !isOwner);
  $('hc-add-floor').classList.toggle('hidden', !isOwner || floorCountFor(cfg) >= MAX_FLOORS);
  $('hc-add-floor').disabled = cfg.construction?.status === 'building';
  $('hc-add-floor').textContent = cfg.construction?.status === 'building' ? 'Construction in progress…' : 'Add Floor · +2 residents';
  $('hc-yard').classList.toggle('hidden', !isOwner);
  $('hc-yard').innerHTML = `${icon('edit')} Edit Yard`;
  if (yardEditingHouse && yardEditingHouse !== id) stopYardEdit();
  showPanel('house-card');
}

function renderNeeds() {
  const house = state.houses.find((entry) => entry.id === selectedHouseId);
  const family = familyClient.state;
  const visible = house?.owner === state.account?.id && family?.houseId === house?.id;
  $('hc-needs').classList.toggle('hidden', !visible);
  if (!visible) return;
  $('hc-needs').innerHTML = NEED_KEYS.map((key) => {
    const value = family.needs[key];
    return `<div class="need-row" title="${FAMILY_NEEDS[key].name}"><span>${FAMILY_NEEDS[key].icon}</span><div class="need-bar"><div class="need-fill ${value <= 30 ? 'low' : ''}" style="width:${value}%"></div></div><span>${Math.round(value)}</span></div>`;
  }).join('');
}

function primaryOwnedHouse() {
  if (!state.account) return null;
  return state.houses.filter((house) => house.owner === state.account.id)
    .sort((a, b) => (a.builtAt || 0) - (b.builtAt || 0))[0] || null;
}

function refreshHomeVitals() {
  const home = primaryOwnedHouse(), panel = $('home-vitals');
  panel.classList.toggle('hidden', !home);
  if (!home) return;
  const family = familyClient.state?.houseId === home.id ? familyClient.state : null;
  $('home-vitals-name').textContent = `${home.name} · Family`;
  $('home-vitals-score').textContent = `${completedResidents(home)} residents`;
  if (!family) {
    $('home-vitals-bars').innerHTML = '';
    $('home-vitals-status').textContent = 'Open Family & supplies to unlock your private family state.';
    return;
  }
  $('home-vitals-bars').innerHTML = NEED_KEYS.map((key) => {
    const value = family.needs[key];
    return `<div class="home-vital ${needState(value)}" title="${FAMILY_NEEDS[key].name}"><span>${FAMILY_NEEDS[key].icon}</span><div class="need-bar"><div class="need-fill ${value <= 30 ? 'low' : ''}" style="width:${value}%"></div></div><span>${Math.round(value)}</span></div>`;
  }).join('');
  panel.classList.toggle('crisis', Boolean(family.activeCrisisNeed));
  const next = NEED_KEYS.slice().sort((a, b) => (family.timeUntilZeroMs[a] ?? Infinity) - (family.timeUntilZeroMs[b] ?? Infinity))[0];
  $('home-vitals-status').textContent = family.activeCrisisNeed
    ? `Restore ${FAMILY_NEEDS[family.activeCrisisNeed].name} to 20. Your home and business stay yours.`
    : `${family.needs[next] <= 10 ? 'Critical: ' : family.needs[next] <= 30 ? 'Low: ' : ''}${FAMILY_NEEDS[next].name} · ${formatNeedTime(family.needs[next], next, family.simulationState)} until zero. Use supplies or complete visits to recover.`;
}

$('hc-add-floor').onclick = async () => {
  if (!requireWallet()) return;
  const house = state.houses.find((entry) => entry.id === selectedHouseId);
  if (!house || house.owner !== state.account?.id) return;
  const floors = floorCountFor(house), cost = floorExtensionCost(house);
  const definition = buildHouseDefinition({ ...house, floorCount: floors + 1 });
  const objects = placementsOf(house.id).objects;
  const errors = [...validateHouseDefinition(definition), ...objects.filter((object) => !validatePlacement(definition, objects, object).ok)];
  if (errors.length) { toast('Clear the stair area before extending this house.', 'err'); return; }
  const eventId = 'floor_' + crypto.randomUUID();
  let spend = null;
  reviewAction({
    title: `Add floor ${floors + 1}`,
    body: `<p>${fmt(cost)} Game Coins · <b>takes 1 hour to build</b> · <b>+2 residents after completion</b></p><p>The timer runs on the server, so it keeps counting even if you close the game. The new floor includes a two-person sleeping area, storage, seating and lighting. Existing furniture keeps its exact position. The roof moves to the new top floor.</p><p>Family after completion: ${residentsFor(floors + 1)} · consumption units ${familyConsumptionFor(floors + 1)}</p>`,
    label: 'Build next floor',
    onConfirm: async () => {
      await ensureFamilySession(true);
      spend ||= storeSpend(house.owner, cost, 'Add family floor', eventId);
      if (!spend) throw new Error('Not enough Game Coins.');
      try {
        const result = await multiplayer.addFloor({ accountId: house.owner, houseId: house.id, eventId, baseFloorCount: floors });
        applyRemoteHouse(result.document);
        refreshHud();
      } catch (error) {
        if (error.message !== 'multiplayer-timeout') { reverseOperation(spend.opId, error.message, 'reverse_' + eventId); spend = null; }
        throw error;
      }
    },
  });
};

$('hc-business').addEventListener('click', () => {
  sfx.click();
  if (!selectedHouseId) return;
  const house = state.houses.find((candidate) => candidate.id === selectedHouseId);
  if (state.businesses[selectedHouseId] && house?.owner !== state.account?.id) openMarketplace(selectedHouseId);
  else if (state.businesses[selectedHouseId]) openBizManage(selectedHouseId);
  else openBizBuy(selectedHouseId);
});

$('hc-budget').addEventListener('click', () => { sfx.click(); openBudget(); });

// ── Yard editing (kept from task3) ───────────────────────────────────────────
function startYardEdit(houseId) {
  yardEditingHouse = houseId;
  $('hc-yard').innerHTML = `${icon('check')} Done`;
  city.setYardEditMode(houseId, true, interiorOf(houseId).yard);
  const cfg = state.houses.find((h) => h.id === houseId);
  if (cfg) city.flyTo(new THREE.Vector3(cfg.plot.x, 0, cfg.plot.z), { distance: 16, height: 13 });
  toast('Tap a glowing spot in the yard to place an outdoor item');
  openYardPanel(null);
}

function stopYardEdit() {
  if (!yardEditingHouse) return;
  city.setYardEditMode(yardEditingHouse, false);
  yardEditingHouse = null;
  $('hc-yard').innerHTML = `${icon('edit')} Edit Yard`;
  hidePanel('item-panel');
}

$('hc-yard').addEventListener('click', () => {
  sfx.click();
  if (yardEditingHouse) stopYardEdit();
  else if (selectedHouseId) startYardEdit(selectedHouseId);
});

function pickYardSlot(e) {
  const rec = city.houseGroups.get(yardEditingHouse);
  if (!rec) return false;
  raycaster.setFromCamera(ndc(e), city.camera);
  const targets = [...Object.values(rec.yardMarkers).filter((m) => m.visible), ...Object.values(rec.yardItems)];
  const hits = raycaster.intersectObjects(targets, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o) {
      const sid = o.userData.yardSlotId || (o.userData.slotId && rec.yardItems[o.userData.slotId] ? o.userData.slotId : null);
      if (sid) {
        sfx.click();
        openYardPanel(sid);
        return true;
      }
      o = o.parent;
    }
  }
  return false;
}

$('hc-inside').addEventListener('click', () => {
  sfx.click();
  if (selectedHouseId) enterInterior(selectedHouseId);
});

$('hc-share').addEventListener('click', async () => {
  sfx.click();
  const url = `${location.origin}${location.pathname}?house=${selectedHouseId}`;
  try {
    await navigator.clipboard.writeText(url);
    toast(`${icon('link')} Personal link copied`, 'ok');
  } catch {
    toast(url, '', 6000);
  }
});

$('hc-links').addEventListener('click', () => {
  sfx.click();
  if (selectedHouseId) enterGraph(selectedHouseId);
});

$('btn-find').addEventListener('click', () => {
  sfx.click();
  const mine = state.houses.filter((h) => h.owner === state.account?.id);
  if (!mine.length) return;
  const cfg = mine[mine.length - 1];
  city.flyTo(new THREE.Vector3(cfg.plot.x, 0, cfg.plot.z), { distance: 20, height: 12 });
  setTimeout(() => selectHouse(cfg.id), 900);
});

// ── Graph mode ───────────────────────────────────────────────────────────────
function enterGraph(houseId) {
  graphMode = true;
  graphHouseId = houseId;
  hidePanel('house-card');
  $('hud').classList.add('hidden');
  showPanel('graph-ui');
  const cfg = state.houses.find((h) => h.id === houseId);
  $('graph-title').textContent = `${cfg?.name || ''} — connections`;
  const links = allLinksOf(houseId);
  city.showGraph(houseId, links);
  sfx.chime();

  $('graph-legend').innerHTML = Object.entries(LINK_TYPES).map(([, t]) =>
    `<span class="legend-item"><span class="legend-dot" style="background:${t.color}"></span>${t.name}</span>`
  ).join('');

  const list = $('graph-links');
  list.innerHTML = '';
  if (!links.length) {
    list.innerHTML = '<div class="graph-empty">No connections yet — new houses and resident visits will create them.</div>';
  }
  links.forEach((l) => {
    const other = state.houses.find((h) => h.id === l.to);
    if (!other) return;
    const t = LINK_TYPES[l.type];
    const row = document.createElement('button');
    row.className = 'link-row';
    row.innerHTML = `<span class="legend-dot" style="background:${t?.color}"></span>
      <span><b>${other.name}</b> <small>${l.reason}</small></span>`;
    row.addEventListener('click', () => {
      sfx.click();
      city.flyTo(new THREE.Vector3(other.plot.x, 0, other.plot.z), {
        distance: 20, height: 12,
        onDone: () => enterGraph(other.id),
      });
    });
    list.appendChild(row);
  });

  const c = state.houses.find((h) => h.id === houseId);
  if (c) city.flyTo(new THREE.Vector3(c.plot.x, 0, c.plot.z), { distance: 34, height: 24 });
}

function exitGraph() {
  graphMode = false;
  city.hideGraph();
  hidePanel('graph-ui');
  $('hud').classList.remove('hidden');
  if (graphHouseId) selectHouse(graphHouseId);
}

$('graph-exit').addEventListener('click', () => { sfx.click(); exitGraph(); });

// ── Picking ──────────────────────────────────────────────────────────────────
let downPos = null;

canvas.addEventListener('pointerdown', (e) => {
  downPos = [e.clientX, e.clientY];
});

canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6) return;
  if (mode === 'city') {
    if (yardEditingHouse && pickYardSlot(e)) return;
    pickHouse(e);
  } else if (mode === 'interior' && editingInterior && interior.viewMode !== 'stacked') {
    pickInterior(e);
  }
});

const raycaster = new THREE.Raycaster();
function ndc(e) {
  return new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}

function pickHouse(e) {
  raycaster.setFromCamera(ndc(e), city.camera);
  const hits = raycaster.intersectObjects(city.scene.children, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o) {
      if (o.userData.houseId) {
        sfx.click();
        if (graphMode) { enterGraph(o.userData.houseId); return; }
        selectHouse(o.userData.houseId);
        const cfg = state.houses.find((h) => h.id === o.userData.houseId);
        if (cfg) city.flyTo(new THREE.Vector3(cfg.plot.x, 0, cfg.plot.z), { distance: 20, height: 12 });
        return;
      }
      o = o.parent;
    }
  }
  if (!graphMode && selectedHouseId) {
    stopYardEdit();
    selectedHouseId = null;
    hidePanel('house-card');
  }
}

// ── Interior (task5) ─────────────────────────────────────────────────────────
const FLOOR_NAMES = ['Ground Floor', 'Second Floor', 'Third Floor'];

function cancelInteriorPlacement() {
  interior.cancelPlacement();
  hidePanel('placement-review');
  if (mode === 'interior') hidePanel('item-panel');
}

function interiorOwnedCount(itemId) {
  return (state.houseInventories[currentInteriorHouse?.id] || []).filter((id) => id === itemId).length + (state.inventory[itemId] || 0);
}
function takeInteriorItem(itemId) {
  const list = state.houseInventories[currentInteriorHouse.id] ||= [];
  const index = list.indexOf(itemId);
  if (index >= 0) { list.splice(index, 1); return true; }
  return takeInventory(itemId);
}
function returnInteriorItem(itemId) {
  (state.houseInventories[currentInteriorHouse.id] ||= []).push(itemId);
}
function canSelectInteriorItem(item) {
  if ((interiorOwnedCount(item.id)) > 0) return true;
  if (item.level > userLevel().level) return false;
  const collection = item.collection ? collectionState(item.collection) : null;
  return !(collection && !collection.active && !collection.upcoming);
}

function previewInteriorPlacement(zone, item) {
  const res = interior.previewPlacement(zone.zoneId, item.id);
  if (!res.ok) {
    void familyClient.placementFailure(res.reason || 'placement-invalid', zone.floorId).catch(() => {});
    return res;
  }
  $('placement-review-name').textContent = item.name;
  $('placement-review-spot').textContent = `${zone.name} · ${res.obj.spotName || 'approved spot'}`;
  showPanel('placement-review');
  hidePanel('item-panel');
  hideObjControls();

  const floor = interior.def.floors.find((candidate) => candidate.floorId === res.obj.floorId);
  interior.controls.target.set(
    res.obj.pos[0],
    (floor?.elevation || 0) + (res.obj.elevated || 0.45),
    res.obj.pos[1],
  );
  interior.controls.update();
  return res;
}

$('placement-cancel').addEventListener('click', () => {
  sfx.click();
  cancelInteriorPlacement();
});

$('placement-confirm').addEventListener('click', () => {
  if (interior.placementState.phase !== 'preview' || !currentInteriorHouse) return;
  const item = ITEMS.find((candidate) => candidate.id === interior.placementState.itemId);
  if (!item) { cancelInteriorPlacement(); return; }
  const owned = interiorOwnedCount(item.id);
  if (!owned && availableCoins() < item.cost) {
    sfx.error();
    toast('Not enough coins', 'err');
    return;
  }
  const res = interior.confirmPreview();
  if (!res.ok) {
    sfx.error();
    hidePanel('placement-review');
    toast(res.reason || 'This approved spot is no longer available.', 'err');
    return;
  }
  if (owned) {
    takeInteriorItem(item.id);
  } else if (!storeSpend(currentInteriorHouse.owner, item.cost, `Item: ${item.name}`)) {
    // Balance was checked immediately above; this only guards a future async
    // economy implementation from leaving an unpaid placement behind.
    interior.removeObject(res.obj.oid);
    sfx.error();
    toast('Not enough coins', 'err');
    cancelInteriorPlacement();
    return;
  }
  hidePanel('placement-review');
  hidePanel('item-panel');
  sfx.coin();
  save();
  autosaveInteriorDraft();
  refreshHud();
  interior.setItemEligibility(canSelectInteriorItem);
  renderFloorTabs();
  interior._refreshMarkers();
  interior.selectObject(null);
  hideObjControls();
  toast(`“${item.name}” placed in ${res.obj.spotName || 'the approved spot'}`, 'ok');
});

/** One-time deterministic migration of old slot interiors (task5 §19). */
function ensureMigrated(cfg) {
  const definition = state.houseDefinitions[cfg.id];
  if (definition?.schemaVersion === SCHEMA_VERSION) return;
  const placements = placementsOf(cfg.id);
  const oldItems = placements.objects || [];
  const legacy = Object.values(interiorOf(cfg.id).slots || {}).flat().filter((item) => typeof item === 'string');
  const migrated = migrateHouseInterior({ ...cfg, houseDefinition: definition }, oldItems, []);
  state.houseDefinitions[cfg.id] = migrated.definition;
  placements.objects = migrated.objects;
  placements.revision = Math.max(1, placements.revision || 0) + 1;
  cfg.floorCount = migrated.floorCount;
  cfg.height = 'one';
  cfg.schemaVersion = SCHEMA_VERSION;
  const returned = [...migrated.returned, ...legacy];
  state.migrationReports[cfg.id] = { migratedAt: Date.now(), schemaVersion: SCHEMA_VERSION, returnedItems: returned };
  state.houseInventories[cfg.id] = [...(state.houseInventories[cfg.id] || []), ...returned];
  interiorOf(cfg.id).slots = {};
  save();
}

function enterInterior(houseId) {
  const cfg = state.houses.find((h) => h.id === houseId);
  if (!cfg) return;
  currentInteriorHouse = cfg;
  editingInterior = false;
  cancelInteriorPlacement();
  ensureMigrated(cfg);
  const canonical = placementsOf(houseId);
  const savedDraft = state.interiorDrafts[houseId];
  const canRestoreDraft = savedDraft && savedDraft.baseRevision === canonical.revision;
  const placementSource = canRestoreDraft
    ? { revision: canonical.revision, objects: savedDraft.objects }
    : canonical;
  interior.build(cfg, placementSource, state.houseDefinitions[houseId]);
  // A restored draft is a working copy, not the last server-accepted layout.
  interior.acceptCommit(canonical);
  interior.setItemEligibility(canSelectInteriorItem);
  if (canRestoreDraft) {
    if (savedDraft.inventory) state.houseInventories[houseId] = [...savedDraft.inventory];
    interior.setFloor(savedDraft.activeFloor || 0);
    interior.setViewMode(savedDraft.viewMode || 'ghost');
    if (savedDraft.camera?.length === 3) interior.camera.position.fromArray(savedDraft.camera);
    if (savedDraft.target?.length === 3) interior.controls.target.fromArray(savedDraft.target);
    interior.controls.update();
    toast('Your autosaved interior draft was restored', 'ok');
  } else if (savedDraft) {
    // A newer canonical revision wins; keep the stale draft out of the editor
    // so it cannot overwrite somebody else's completed save.
    delete state.interiorDrafts[houseId];
    save();
  }
  const isOwner = state.account && cfg.owner === state.account.id;
  $('interior-name').textContent = `${cfg.name} · @${cfg.nickname}`;
  $('interior-edit').classList.toggle('hidden', !isOwner);
  $('interior-edit').innerHTML = `${icon('sofa')} Edit`;
  $('edit-tools').classList.add('hidden');
  $('obj-controls').classList.add('hidden');
  hidePanel('item-panel');
  renderFloorTabs();
  renderViewModes();
  setMode('interior');
  sfx.whoosh();
  if (!canRestoreDraft) {
    interior.camera.position.set(0, 12, 17);
    const targetPos = new THREE.Vector3(0, 7, 12);
    tween({
      duration: 1100, ease: Ease.inOut,
      onUpdate: (k) => {
        interior.camera.position.lerpVectors(new THREE.Vector3(0, 12, 17), targetPos, k);
      },
    });
  }
}

function autosaveInteriorDraft() {
  if (!editingInterior || !currentInteriorHouse) return;
  state.interiorDrafts[currentInteriorHouse.id] = {
    baseRevision: interior.baseRevision,
    schemaVersion: SCHEMA_VERSION,
    objects: JSON.parse(JSON.stringify(interior.objects)),
    inventory: [...(state.houseInventories[currentInteriorHouse.id] || [])],
    activeFloor: interior.activeFloor,
    viewMode: interior.viewMode,
    camera: interior.camera.position.toArray(),
    target: interior.controls.target.toArray(),
    updatedAt: Date.now(),
  };
  save();
}

function renderFloorTabs() {
  const tabs = $('floor-tabs');
  tabs.innerHTML = '';
  const allMessages = [];
  interior.def.floors.forEach((floor, i) => {
    const stats = interior.floorStats(i);
    allMessages.push(...stats.messages);
    const b = document.createElement('button');
    b.className = 'floor-tab' + (i === interior.activeFloor ? ' active' : '');
    const name = floor.isAttic ? 'Attic' : FLOOR_NAMES[i] || `Floor ${i + 1}`;
    b.innerHTML = `${name} <small>${stats.objects} items · ${stats.complete
      ? '<span class="ft-ready">Ready ✓</span>'
      : `<span class="ft-err">${stats.errors} issues ⚠</span>`}</small>`;
    b.addEventListener('click', () => {
      sfx.click();
      // switching floors keeps unsaved changes and history (task5 §7)
      cancelInteriorPlacement();
      interior.setFloor(i);
      hidePanel('item-panel');
      renderFloorTabs();
      hideObjControls();
      autosaveInteriorDraft();
    });
    tabs.appendChild(b);
  });
  $('editor-validation').innerHTML = allMessages.length
    ? `<b>Needs attention</b><span>${esc(allMessages[0])}</span>`
    : '<b>House validated ✓</b><span>Structure, openings, stairs and placed objects are valid.</span>';
  $('editor-validation').classList.toggle('has-errors', allMessages.length > 0);
}

const VIEW_MODES = [
  ['isolate', 'Isolate'], ['ghost', 'Ghost Below'], ['stacked', 'Stacked'], ['cutaway', 'Cutaway'],
];
function renderViewModes() {
  const box = $('view-modes');
  box.innerHTML = '';
  for (const [id, name] of VIEW_MODES) {
    const b = document.createElement('button');
    b.className = 'view-mode' + (interior.viewMode === id ? ' active' : '');
    b.textContent = name;
    b.addEventListener('click', () => {
      sfx.click();
      cancelInteriorPlacement();
      interior.setViewMode(id);
      hidePanel('item-panel');
      interior._refreshMarkers();
      renderViewModes();
      if (id === 'stacked') {
        interior.selectObject(null);
        hideObjControls();
      }
      autosaveInteriorDraft();
    });
    box.appendChild(b);
  }
}

$('interior-exit').addEventListener('click', async () => {
  sfx.click();
  cancelInteriorPlacement();
  // Opening and closing an unchanged interior is a valid no-op (task8 §21.3):
  // no mutation, no dialog, no error.
  if (editingInterior && !(await leaveInteriorEditor())) return;
  setMode('city');
  sfx.whoosh();
  hidePanel('item-panel');
  if (currentInteriorHouse) {
    city.flyTo(new THREE.Vector3(currentInteriorHouse.plot.x, 0, currentInteriorHouse.plot.z), { distance: 20, height: 12 });
  }
});

$('interior-edit').addEventListener('click', () => {
  sfx.click();
  if (editingInterior) { void leaveInteriorEditor(); return; }
  cancelInteriorPlacement();
  hideObjControls();
  hidePanel('item-panel');
  editingInterior = true;
  $('interior-edit').innerHTML = `${icon('check')} Done`;
  $('edit-tools').classList.remove('hidden');
  interior.setItemEligibility(canSelectInteriorItem);
  interior.setEditMode(true);
  autosaveInteriorDraft();
  toast('Tap a glowing socket, preview the item, then confirm or cancel');
});

/** Atomic save (task5 §17): the whole revision is applied or nothing is. */
let interiorSaving = false;
function closeInteriorEditor(house) {
  delete state.interiorDrafts[house.id];
  editingInterior = false;
  interior.setEditMode(false);
  $('edit-tools').classList.add('hidden');
  $('interior-edit').innerHTML = `${icon('sofa')} Edit`;
  hideObjControls();
  hidePanel('item-panel');
  save();
  updateReserveFlag(house.id);
  renderFloorTabs();
}

/**
 * Leave the editor (task8 §21.3).
 *
 * Unchanged: exit immediately. Changed: offer Save, Discard and Continue
 * editing. A double click cannot start two exits because `interiorSaving`
 * guards the whole path.
 */
async function leaveInteriorEditor() {
  if (interiorSaving) return false;
  cancelInteriorPlacement();
  if (!currentInteriorHouse) return true;
  if (!interior.dirtyState) {
    closeInteriorEditor(currentInteriorHouse);
    return true;
  }
  const choice = await askInteriorExitChoice();
  if (choice === 'continue') return false;
  if (choice === 'discard') {
    interior.cancelEdits();
    delete state.interiorDrafts[currentInteriorHouse.id];
    closeInteriorEditor(currentInteriorHouse);
    interior.setItemEligibility(canSelectInteriorItem);
    renderFloorTabs();
    toast('Changes discarded. The saved layout is back.', 'ok');
    return true;
  }
  return finishInteriorEdit();
}

/** Save / Discard / Continue editing, resolved by the player's choice. */
function askInteriorExitChoice() {
  return new Promise((resolve) => {
    $('review-title').textContent = 'Unsaved interior changes';
    $('review-content').innerHTML = '<p>This interior has unsaved changes. What would you like to do?</p>';
    $('review-error').textContent = '';
    const actions = $('modal-review').querySelector('.acct-actions');
    const original = actions.innerHTML;
    actions.innerHTML = `
      <button class="btn btn-ghost" data-choice="continue">Continue editing</button>
      <button class="btn btn-ghost" data-choice="discard">Discard changes</button>
      <button class="btn btn-primary" data-choice="save">Save changes</button>`;
    const finish = (choice) => {
      actions.innerHTML = original;
      hidePanel('modal-review');
      resolve(choice);
    };
    actions.querySelectorAll('[data-choice]').forEach((button) => {
      button.addEventListener('click', () => { sfx.click(); finish(button.dataset.choice); });
    });
    showPanel('modal-review');
  });
}

async function finishInteriorEdit() {
  if (interiorSaving) return false;
  cancelInteriorPlacement();
  if (!currentInteriorHouse) return false;
  const result = interior.commit();
  if (!result.ok) { toast(result.errors[0]?.reason || 'Resolve the highlighted placement before saving.', 'err'); return false; }
  const house = currentInteriorHouse;
  if (result.unchanged) {
    closeInteriorEditor(house);
    return true;
  }
  interiorSaving = true;
  $('interior-edit').disabled = true;
  $('interior-edit').textContent = 'Saving…';
  try {
    await ensureFamilySession(true);
    const canonical = await multiplayer.saveHouse(publicHouseDocument(house, {
      placements: { revision: interior.baseRevision + 1, schemaVersion: SCHEMA_VERSION, objects: result.objects },
    }), { basePlacementsRevision: interior.baseRevision });
    assignPublicHouseDocument(canonical);
    interior.acceptCommit(canonical.placements);
    closeInteriorEditor(house);
    // A no-op save keeps the same revision and produces no announcement.
    if (canonical.status !== 'NO_CHANGES') toast('Interior saved and synchronized with every player.', 'ok');
    return true;
  } catch (error) {
    autosaveInteriorDraft();
    toast(error.message.includes('revision-conflict')
      ? 'Another editor saved this house. Your draft is kept; reopen the interior to review the latest layout.'
      : 'Could not save yet. Your draft is kept; retry when connected.', 'err', 6500);
    return false;
  } finally {
    interiorSaving = false;
    $('interior-edit').disabled = false;
    $('interior-edit').innerHTML = editingInterior ? `${icon('check')} Done` : `${icon('sofa')} Edit`;
  }
}

// undo/redo with inventory reconciliation (purchased items never vanish, §16)
function withInvSync(fn) {
  const before = interior.objects.map((o) => o.itemId);
  const changed = fn();
  if (!changed) return;
  const after = interior.objects.map((o) => o.itemId);
  const diff = {};
  before.forEach((id) => { diff[id] = (diff[id] || 0) + 1; });
  after.forEach((id) => { diff[id] = (diff[id] || 0) - 1; });
  for (const [id, n] of Object.entries(diff)) {
    for (let i = 0; i < n; i++) returnInteriorItem(id);
    for (let i = 0; i < -n; i++) takeInteriorItem(id);
  }
  save();
  autosaveInteriorDraft();
  interior.setItemEligibility(canSelectInteriorItem);
  renderFloorTabs();
  hideObjControls();
}

$('ed-undo').addEventListener('click', () => { sfx.click(); withInvSync(() => interior.undo()); });
$('ed-redo').addEventListener('click', () => { sfx.click(); withInvSync(() => interior.redo()); });

function pickInteriorObject(e) {
  raycaster.setFromCamera(ndc(e), interior.camera);
  const meshes = [];
  for (const [oid, mesh] of Object.entries(interior.objectMeshes)) {
    const obj = interior.objects.find((o) => o.oid === oid);
    if (obj && interior._floorIndexOf(obj) === interior.activeFloor && mesh.visible) meshes.push(mesh);
  }
  const hits = raycaster.intersectObjects(meshes, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o) {
      if (o.userData.oid) return o.userData.oid;
      o = o.parent;
    }
  }
  return null;
}

function pickInterior(e) {
  // A placed object wins over the glowing marker below it. The old order
  // reopened the catalog immediately after selecting furniture.
  const oid = pickInteriorObject(e);
  if (oid) {
    sfx.click();
    cancelInteriorPlacement();
    interior.selectObject(oid);
    showObjControls(oid);
    return;
  }

  raycaster.setFromCamera(ndc(e), interior.camera);
  const markers = Object.values(interior.zoneMarkers).filter((m) => m.visible);
  const hits = raycaster.intersectObjects(markers, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o) {
      if (o.userData.zoneId) {
        sfx.click();
        openZonePanel(o.userData.zoneId);
        return;
      }
      o = o.parent;
    }
  }
  cancelInteriorPlacement();
  interior.selectObject(null);
  hideObjControls();
}

function showObjControls(oid) {
  const obj = interior.objects.find((o) => o.oid === oid);
  if (!obj) return;
  const item = ITEMS.find((i) => i.id === obj.itemId);
  $('obj-name').textContent = item?.name || obj.itemId;
  showPanel('obj-controls');
  $('obj-rotate').onclick = () => {
    sfx.click();
    const r = interior.rotateObject(oid);
    if (!r.ok) toast(r.reason || 'Cannot rotate here', 'err');
    else autosaveInteriorDraft();
  };
  $('obj-reset').onclick = () => {
    sfx.click();
    const r = interior.resetObject(oid);
    if (!r.ok) toast(r.reason || 'No suggested spot free', 'err');
    else autosaveInteriorDraft();
  };
  $('obj-remove').onclick = () => {
    sfx.click();
    const removed = interior.removeObject(oid);
    if (removed) {
      returnInteriorItem(removed.itemId);
      save();
      autosaveInteriorDraft();
      interior.setItemEligibility(canSelectInteriorItem);
      toast(`“${item?.name}” moved to your inventory`);
      renderFloorTabs();
    }
    hideObjControls();
  };
}

function hideObjControls() {
  hidePanel('obj-controls');
}

function openZonePanel(zoneId) {
  const zone = findZone(interior.def, zoneId);
  if (!zone || !currentInteriorHouse) return;
  const opened = interior.beginPlacement(zoneId);
  if (!opened.ok) {
    cancelInteriorPlacement();
    toast(opened.reason, 'err');
    return;
  }
  hidePanel('placement-review');
  interior.selectObject(null);
  hideObjControls();
  const list = $('item-list');
  $('item-panel-title').textContent = `${zone.name} — pick an item`;
  list.innerHTML = '';
  showPanel('item-panel');

  const lvl = userLevel().level;

  const candidates = ITEMS.filter((item) =>
    item.slots.some((slot) => zone.types.includes(slot)) && interior.canPlace(zoneId, item.id));
  for (const item of candidates) {
    const locked = item.level > lvl;
    const col = item.collection ? collectionState(item.collection) : null;
    const archived = col && !col.active && !col.upcoming;
    const owned = interiorOwnedCount(item.id);
    const b = document.createElement('button');
    b.className = 'item-card' + (archived && !owned ? ' blocked' : '');
    const badge = col
      ? (col.active
        ? `<span class="item-badge">${col.name}</span>`
        : `<span class="item-badge archived">Archived · ${col.from.slice(5)}—${col.to.slice(5)}</span>`)
      : '';
    const setLbl = item.set ? `<span class="item-set">${SETS[item.set]} set</span>` : '';
    b.innerHTML = `<div class="opt-name">${item.name}</div>
      <div class="item-rarity r-${item.rarity}">${item.rarity}</div>
      ${badge}${setLbl}
      ${owned
        ? `<div class="opt-cost">You own ×${owned} — place free</div>`
        : locked
          ? `<div class="opt-lock">${icon('lock')} level ${item.level}</div>`
          : archived
            ? `<div class="opt-lock">${icon('lock')} collection ended</div>`
            : `<div class="opt-cost">${fmt(item.cost)} ${gem}</div>`}`;
    b.addEventListener('click', () => {
      if (!owned) {
        if (archived) { sfx.error(); toast('This weekly collection is archived — installed copies stay', 'err'); return; }
        if (locked) { sfx.error(); toast(`This item unlocks at level ${item.level}`, 'err'); return; }
        if (availableCoins() < item.cost) { sfx.error(); toast('Not enough coins', 'err'); return; }
      }
      const res = previewInteriorPlacement(zone, item);
      if (!res.ok) { sfx.error(); toast(res.reason, 'err', 4200); return; }
      sfx.click();
      toast('Preview ready — orbit the room, then confirm or cancel');
    });
    list.appendChild(b);
  }
}

$('item-panel-close').addEventListener('click', () => {
  sfx.click();
  cancelInteriorPlacement();
  hidePanel('item-panel');
});

// ── Yard item panel (legacy sockets kept from task3) ─────────────────────────
function openYardPanel(slotId) {
  const list = $('item-list');
  const houseId = yardEditingHouse;
  const slotMeta = YARD_SLOTS.find((s) => s.id === slotId);
  $('item-panel-title').textContent = slotMeta ? `${slotMeta.name} — pick an item` : 'Tap a glowing spot in the yard';
  list.innerHTML = '';
  showPanel('item-panel');
  if (!slotMeta || !houseId) return;

  const data = interiorOf(houseId);
  const owner = state.houses.find((h) => h.id === houseId)?.owner;
  const lvl = userLevel().level;
  const installed = data.yard[slotId];

  if (installed) {
    const rm = document.createElement('button');
    rm.className = 'item-card';
    rm.innerHTML = `<div class="opt-name">${icon('trash')} Remove item</div><div class="item-rarity">returns to inventory</div>`;
    rm.addEventListener('click', () => {
      sfx.click();
      addInventory(data.yard[slotId]);
      delete data.yard[slotId];
      save();
      city.removeYardItem(houseId, slotId);
      updateReserveFlag(houseId);
      city.setYardEditMode(houseId, true, data.yard);
      openYardPanel(slotId);
    });
    list.appendChild(rm);
  }

  for (const item of ITEMS.filter((i) => i.slots.includes('yard'))) {
    const locked = item.level > lvl;
    const cur = installed === item.id;
    const col = item.collection ? collectionState(item.collection) : null;
    const archived = col && !col.active && !col.upcoming;
    const owned = state.inventory[item.id] || 0;
    const b = document.createElement('button');
    b.className = 'item-card' + (cur ? ' installed' : '') + (archived && !cur && !owned ? ' blocked' : '');
    b.innerHTML = `<div class="opt-name">${cur ? '✓ ' : ''}${item.name}</div>
      <div class="item-rarity r-${item.rarity}">${item.rarity}</div>
      ${owned && !cur
        ? `<div class="opt-cost">You own ×${owned} — place free</div>`
        : locked
          ? `<div class="opt-lock">${icon('lock')} level ${item.level}</div>`
          : archived
            ? `<div class="opt-lock">${icon('lock')} collection ended</div>`
            : `<div class="opt-cost">${fmt(item.cost)} ${gem}</div>`}`;
    b.addEventListener('click', () => {
      if (cur) return;
      if (!owned) {
        if (archived) { sfx.error(); toast('This weekly collection is archived', 'err'); return; }
        if (locked) { sfx.error(); toast(`This item unlocks at level ${item.level}`, 'err'); return; }
        if (availableCoins() < item.cost) { sfx.error(); toast('Not enough coins', 'err'); return; }
      }
      if (owned) takeInventory(item.id);
      else if (!storeSpend(owner, item.cost, `Item: ${item.name}`)) { toast('Not enough coins', 'err'); return; }
      if (installed) addInventory(installed);
      sfx.coin();
      data.yard[slotId] = item.id;
      save();
      city.placeYardItem(houseId, slotId, item.id, true);
      updateReserveFlag(houseId);
      city.setYardEditMode(houseId, true, data.yard);
      refreshHud();
      openYardPanel(slotId);
      toast(`“${item.name}” installed`, 'ok');
    });
    list.appendChild(b);
  }
}

// ── WASD camera (task4 §27) ──────────────────────────────────────────────────
const keys = {};
const camVel = new THREE.Vector3();

addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyA') {
    e.preventDefault();
    if (import.meta.env.DEV) openAdmin();
    else toast('Token configuration is available only through the protected admin service', 'err');
    return;
  }
  if (e.code === 'Escape') { handleEscape(); return; }
  if (isTyping()) return; // §27: WASD is disabled while a text field is focused
  keys[e.code] = true;
  if (e.code === 'Space' && mode === 'city') {
    e.preventDefault();
    const target = selectedHouseId || state.houses.find((h) => h.owner === state.account?.id)?.id;
    const cfg = state.houses.find((h) => h.id === target);
    if (cfg) city.flyTo(new THREE.Vector3(cfg.plot.x, 0, cfg.plot.z), { distance: 20, height: 12 });
  }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

function handleEscape() {
  // close the topmost UI layer first, then exit the current mode
  for (const id of ['modal-review', 'modal-family', 'modal-admin', 'modal-fund', 'modal-withdraw', 'modal-budget', 'modal-bizbuy', 'modal-bizmanage', 'modal-marketplace', 'modal-account', 'modal-wallet']) {
    if (!$(id).classList.contains('hidden')) { hidePanel(id); return; }
  }
  if (!$('placement-review').classList.contains('hidden')) { cancelInteriorPlacement(); return; }
  if (!$('item-panel').classList.contains('hidden')) {
    if (mode === 'interior') cancelInteriorPlacement();
    else hidePanel('item-panel');
    return;
  }
  if (yardEditingHouse) { stopYardEdit(); return; }
  if (graphMode) { exitGraph(); return; }
  if (mode === 'builder') { $('builder-exit').click(); return; }
  if (mode === 'interior') { $('interior-exit').click(); return; }
  if (selectedHouseId) { selectedHouseId = null; hidePanel('house-card'); }
}

function updateWasd(dt) {
  if (mode !== 'city' || isTyping()) return;
  const fwd = new THREE.Vector3().subVectors(city.controls.target, city.camera.position);
  fwd.y = 0;
  if (fwd.lengthSq() < 0.001) return;
  fwd.normalize();
  const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const dir = new THREE.Vector3();
  if (keys.KeyW) dir.add(fwd);
  if (keys.KeyS) dir.sub(fwd);
  if (keys.KeyA) dir.add(right);
  if (keys.KeyD) dir.sub(right);
  const speed = keys.ShiftLeft || keys.ShiftRight ? 38 : 18;
  const desired = dir.lengthSq() > 0 ? dir.normalize().multiplyScalar(speed) : new THREE.Vector3();
  // smooth acceleration & deceleration, no sudden jumps (§27)
  camVel.lerp(desired, Math.min(1, dt * 5.6));
  if (camVel.lengthSq() > 0.01) {
    if (desired.lengthSq() > 0) city.cancelFly?.();
    const step = camVel.clone().multiplyScalar(dt);
    city.camera.position.add(step);
    city.controls.target.add(step);
    // The playable-area boundary is enforced centrally every frame in
    // city.update() (_clampToBounds), so keyboard movement needs no separate
    // clamp here — it can never push the camera past the safe edge.
  }
  // optional Q/E rotation around the target
  const rot = (keys.KeyQ ? 1 : 0) - (keys.KeyE ? 1 : 0);
  if (rot) {
    const p = city.camera.position.clone().sub(city.controls.target);
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 1.4);
    city.camera.position.copy(city.controls.target).add(p);
  }
}

// ── Admin: protected token configuration (task4 §18) ─────────────────────────
const ADMIN_FIELDS = [
  ['symbol', 'Displayed token symbol', 'text'],
  ['feePct', 'Conversion fee % (from config, never hardcoded)', 'number'],
  ['marketplaceFeePct', 'Marketplace fee %', 'number'],
  ['maxSlippagePct', 'Max slippage %', 'number'],
  ['maxDeviationPct', 'Max price deviation %', 'number'],
  ['minLiquidity', 'Minimum liquidity', 'number'],
  ['dailyFundLimit', 'Daily funding limit', 'number'],
  ['dailyWithdrawLimit', 'Daily withdrawal limit', 'number'],
  ['minWithdraw', 'Minimum withdrawal', 'number'],
];

function readAdminForm() {
  const c = state.tokenConfig;
  document.querySelectorAll('[data-cfg]').forEach((el) => {
    c[el.dataset.cfg] = el.type === 'number' ? +el.value : el.value.trim();
  });
  return c;
}

/**
 * Live chain status for the in-game panel. The contract address, chain and
 * vault are read-only here: they are configured on the protected operations
 * page and served by /api/token-config (task8 §7.1, §8).
 */
async function renderAdminWalletChecks() {
  const host = $('admin-wallet-checks');
  const config = chain.config();
  const token = config?.token;
  const network = chain.network();
  const rows = [
    `<div class="admin-wallet-row"><span><b>Network</b><br><small>chain id ${network.chainId} · gas ${network.nativeCurrency.symbol}</small></span><b>${esc(network.networkName)}</b></div>`,
    token
      ? `<div class="admin-wallet-row"><span><b>Active token</b><br><small><a href="${esc(token.explorerUrl)}" target="_blank" rel="noreferrer noopener">${esc(token.tokenAddress)}</a></small></span><b>${esc(token.tokenSymbol)} v${esc(token.configVersion)} · ${esc(token.tokenDecimals)}d</b></div>`
      : '<div class="admin-wallet-row"><span><b>Active token</b><br><small>Configure it on the protected operations page</small></span><b>none</b></div>',
    token
      ? `<div class="admin-wallet-row"><span><b>Deposit vault</b><br><small><a href="${esc(token.vaultExplorerUrl)}" target="_blank" rel="noreferrer noopener">${esc(token.vaultAddress)}</a></small></span><b>${esc(token.status)}</b></div>`
      : '',
  ];
  const link = chain.currentLink();
  if (link) {
    const balances = await chain.balances(link.address).catch(() => null);
    rows.push(`<div class="admin-wallet-row"><span><b>Signed-in wallet</b><br><small>${esc(shortAddr(link.address))}</small></span><b>${
      balances ? `${esc(balances.tokenDisplay ?? '0')} ${esc(config?.token?.tokenSymbol || TOKEN.name)} · ${esc(balances.nativeDisplay)} ETH` : 'unavailable'
    }</b></div>`);
  }
  host.innerHTML = rows.filter(Boolean).join('');
}

function openAdmin() {
  const c = state.tokenConfig;
  const grid = $('admin-grid');
  grid.innerHTML = ADMIN_FIELDS.map(([key, label, type, options, cls]) => `
    <label class="${cls || ''}">${label}
      ${type === 'select'
        ? `<select data-cfg="${key}">${options.map((o) => `<option ${c[key] === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<input data-cfg="${key}" type="${type}" value="${c[key] ?? ''}" />`}
    </label>`).join('') + `
    <label class="admin-full">Feature flags (independent, task4 §33)
      <span>
        ${['funding', 'marketplace', 'withdrawal'].map((f) =>
          `<button class="role-chip ${c.flags[f] ? 'on' : ''}" data-flag="${f}">${f}</button>`).join(' ')}
      </span>
    </label>
    <div class="admin-full muted">Token contract, deposit vault, chain id and settlement policy are managed on the protected
      operations page and validated on chain. This panel only changes the local game economy.</div>`;
  grid.querySelectorAll('[data-flag]').forEach((b) => {
    b.addEventListener('click', () => {
      c.flags[b.dataset.flag] = !c.flags[b.dataset.flag];
      auditLog('flag-toggle', { flag: b.dataset.flag, value: c.flags[b.dataset.flag] });
      openAdmin();
    });
  });
  $('admin-audit').innerHTML = state.audit.slice(0, 10).map((a) =>
    `<div>· ${new Date(a.ts).toLocaleTimeString()} — ${a.action}${a.flag ? ` (${a.flag}=${a.value})` : ''}</div>`).join('') || '<div>No audit entries.</div>';
  showPanel('modal-admin');
  void renderAdminWalletChecks();
}

$('admin-refresh-chain')?.addEventListener('click', async () => {
  sfx.click();
  await chain.loadConfig({ force: true });
  openAdmin();
  toast('Token configuration reloaded from the backend', 'ok');
});

$('admin-save').addEventListener('click', () => {
  sfx.click();
  const c = readAdminForm();
  c.version++;
  state.tokenConfigHistory.unshift(JSON.parse(JSON.stringify({ ...c, chain: undefined })));
  state.tokenConfigHistory = state.tokenConfigHistory.slice(0, 20);
  auditLog('token-config-save', { version: c.version });
  save();
  toast(`Configuration saved · version ${c.version} (previous versions remain in the audit log)`, 'ok');
});

// ── Sound ────────────────────────────────────────────────────────────────────
$('btn-sound').addEventListener('click', () => {
  state.muted = !state.muted;
  save();
  applyMute();
  refreshHud();
  sfx.click();
});
$('btn-whitepaper').addEventListener('click', () => {
  sfx.click();
  showPanel('modal-whitepaper');
});
addEventListener('pointerdown', () => startAmbient(), { once: true });

// ── Demo town on first launch ────────────────────────────────────────────────
function seedCity() {
  const demos = [
    { name: 'Plaza Corner', nickname: 'satoshi', foundation: 'compact', height: 'attic', material: 'wood', roof: 'gable', kit: 'cozy', detail: 'none', scheme: 'warm', companion: 'cafe' },
    { name: 'Cedar Rows', nickname: 'gardener', foundation: 'wide', height: 'one', material: 'wood', roof: 'shed', kit: 'open', detail: 'solar', scheme: 'light', companion: 'flower' },
    { name: 'Ember Hall', nickname: 'baker_b', foundation: 'compact', height: 'two', material: 'brick', roof: 'gable', kit: 'cozy', detail: 'balcony', scheme: 'warm', companion: 'bakery' },
    { name: 'Forge Yard', nickname: 'tinker', foundation: 'wide', height: 'one', material: 'brick', roof: 'flat', kit: 'open', detail: 'antenna', scheme: 'dark', companion: 'workshop' },
    { name: 'Alabaster', nickname: 'curator', foundation: 'wide', height: 'two', material: 'stone', roof: 'flat', kit: 'open', detail: 'solar', scheme: 'light', companion: 'library' },
    { name: 'Dove House', nickname: 'dreamer', foundation: 'lshape', height: 'attic', material: 'stone', roof: 'gable', kit: 'cozy', detail: 'none', scheme: 'warm', companion: 'gallery' },
    { name: 'Neo Court', nickname: 'neo', foundation: 'compact', height: 'two', material: 'tech', roof: 'flat', kit: 'tech', detail: 'token', scheme: 'cold', companion: 'arcade' },
    { name: 'Signal Box', nickname: 'uplink', foundation: 'wide', height: 'one', material: 'tech', roof: 'shed', kit: 'tech', detail: 'antenna', scheme: 'dark', companion: 'techstore' },
  ];
  demos.forEach((d, i) => {
    const cfg = { id: 'demo_' + i, owner: 'demo' + (i % 4), ...d, builtAt: Date.now() - (demos.length - i) * 86400000 };
    const plot = city.pickPlot(cfg, state.houses);
    if (!plot) return;
    cfg.plot = { i: plot.i, x: round2(plot.x), z: round2(plot.z) };
    plot.taken = true;
    addHouse(cfg);
  });
  state.visits.demo_0 = { demo_2: 4 };
  for (const h of state.houses) {
    state.links[h.id] = city.computeLinks(h, state.houses, state.visits);
  }
  interiorOf('demo_0').slots = { center: 'rug', left: 'sofa', mid: 'table', wall_l: 'meme_poster', shelf: 'gm_clock', entry: 'doormat' };
  interiorOf('demo_2').slots = { center: 'rug_trap', mid: 'copycat_printer', wall_r: 'nothing_cert', shelf: 'official_stamp' };
  interiorOf('demo_4').slots = { corner_bl: 'reserve_safe', mid: 'ticker_gen', wall_l: 'asset_board', shelf: 'bull_bust', sill: 'telescope' };
  interiorOf('demo_6').slots = { corner_bl: 'server_rack', mid: 'terminal', wall_r: 'nft_frame', shelf: 'holo_token', corner_fr: 'brain_lamp' };
  interiorOf('demo_4').yard = { yard_a: 'oil_barrel', yard_b: 'bull_statue', yard_c: 'dept_flag' };
  interiorOf('demo_0').yard = { yard_a: 'touch_patch' };
  interiorOf('demo_6').yard = { yard_b: 'exit_fountain' };
  save();
}

/** Demo economy: existing companions become already-owned businesses with
 *  stock, and demo accounts get seeded coins so their residents can shop. */
function backfillBusinesses() {
  const demoOwners = new Set();
  for (const h of state.houses) {
    if (h.companion && !state.businesses[h.id]) {
      const type = COMPANION_TO_BUSINESS[h.companion] || 'cafe';
      const biz = mkBusiness(type);
      for (const p of BUSINESS_TYPES[type].products) biz.stock[p.id] = 6;
      state.businesses[h.id] = biz;
    }
    if (h.owner.startsWith('demo')) demoOwners.add(h.owner);
  }
  for (const owner of demoOwners) {
    issueCoins(owner, 6000, { signature: 'seed_' + owner, reason: 'seed' });
  }
}

/** One-time reset: reverse the 1,000,000-coin test grant that older builds
 *  issued, so every account starts at zero again. Idempotent — the reversal
 *  is keyed, so it runs at most once per account and never double-reverses. */
function resetTestBalance() {
  if (!state.account) return;
  const grantOpId = state.ledger.keys[`sig_test_balance_v1_${state.account.id}`];
  if (!grantOpId) return;
  const reversalKey = `reset_test_balance_v1_${state.account.id}`;
  if (state.ledger.keys[reversalKey]) return;
  reverseOperation(grantOpId, 'test-balance-reset', reversalKey);
}

// ── Boot ─────────────────────────────────────────────────────────────────────
/** Live kill switch: an already-open page goes black within seconds when an
 *  admin flips the flag. Fails open on any read error. */
function startBlackoutWatch() {
  const applyBlack = () => {
    if (window.__DSH_BLACKOUT__) return;
    window.__DSH_BLACKOUT__ = true;
    document.documentElement.style.background = '#000';
    if (document.body) {
      document.body.style.background = '#000';
      const cover = document.createElement('div');
      cover.setAttribute('style', 'position:fixed;inset:0;background:#000;z-index:2147483647');
      document.body.appendChild(cover);
    }
    // Reload after a moment so the game fully stops behind the black screen.
    setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 800);
  };
  const check = async () => {
    try {
      const res = await fetch(`/api/site-blackout?t=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data && data.blackout === true) applyBlack();
      }
    } catch { /* fail open */ }
  };
  void check();
  setInterval(check, 10000);
}

async function boot() {
  // Admin kill switch: if the head guard already blacked out the site, do not
  // boot the game at all. (The head guard paints the black screen; this stops
  // any game work behind it.)
  if (typeof window !== 'undefined' && window.__DSH_BLACKOUT__) return;
  startBlackoutWatch();
  applyStaticUi();
  renderPublicContractAddress();
  void refreshPublicContractAddress();
  const hadSave = load();
  // The active project token is published by the backend; the browser never
  // hard-codes a contract address (task8 §8).
  const chainConfig = await chain.loadConfig().catch(() => null);
  applyPublicChainConfig(chainConfig);
  if (!hadSave || state.houses.length === 0 || !state.houses[0].material) {
    state.houses = [];
    state.links = {};
    state.visits = {};
    seedCity();
  }
  // migrated v3 accounts: old coin balance is issued into the ledger once
  if (state.account?.migratedCoins > 0) {
    issueCoins(state.account.id, state.account.migratedCoins, {
      signature: 'migration_' + state.account.id, reason: 'migration',
    });
    delete state.account.migratedCoins;
    save();
  }
  backfillBusinesses();
  resetTestBalance();
  reconcile(); // journal is the source of truth (task4 §9.5)

  const sharedWorldReady = await multiplayer.start();
  if (!sharedWorldReady) {
    toast('The shared city is reconnecting. Viewing still works; building resumes when the connection returns.', 'err', 6500);
  }
  // A stored wallet session resubscribes to its private deposit and withdrawal
  // channels after a reload or a reconnect (task8 §16.2).
  chain.subscribe();

  for (const cfg of state.houses) {
    ensureMigrated(cfg);
    const plot = city.plots[cfg.plot?.i];
    if (plot) plot.taken = true;
    const rec = city.addHouse(cfg, { yard: interiorOf(cfg.id).yard });
    ensureBusinessVisual(cfg);
    residents.addForHouse(rec, completedResidents(rec.cfg));
    updateReserveFlag(cfg.id);
  }
  residents.addCitizens(7);
  save();
  refreshHud();
  const bootPaymentWallet = activeWallet('paymentWallet');
  if (bootPaymentWallet && bootPaymentWallet.provider !== 'demo') refreshOnChainBalance(bootPaymentWallet);

  const params = new URLSearchParams(location.search);
  const houseId = params.get('house');
  const interiorTestHouse = params.get('interior-test') === '1'
    ? (state.houses.find((house) => house.id === 'demo_0') || state.houses[0])
    : null;
  const visualTest = params.get('visual-test') === '1'
    ? buildVisualTestDeck(city.scene)
    : null;
  if (params.get('visual-audit') === '1') {
    const output = document.createElement('output');
    output.id = 'visual-audit';
    output.hidden = true;
    document.body.appendChild(output);
    import('./visualAudit.js')
      .then(({ auditVisualAssets }) => { output.textContent = JSON.stringify(auditVisualAssets()); })
      .catch((error) => { output.textContent = JSON.stringify({ error: error.message }); });
  }
  if (params.get('time') === 'night') city.phase = 0.82;

  let p = 0;
  const int = setInterval(() => {
    p = Math.min(100, p + 14 + Math.random() * 18);
    $('loader-fill').style.width = p + '%';
    if (p >= 100) {
      clearInterval(int);
      setTimeout(() => {
        $('loader').classList.add('fade');
        $('hud').classList.remove('hidden');
        setTimeout(() => $('loader').remove(), 700);
        if (interiorTestHouse) {
          enterInterior(interiorTestHouse.id);
        } else if (visualTest) {
          city.camera.position.copy(visualTest.camera);
          city.controls.target.copy(visualTest.target);
          city.controls.update();
        } else if (houseId && state.houses.some((h) => h.id === houseId)) {
          const cfg = state.houses.find((h) => h.id === houseId);
          city.placeAt(new THREE.Vector3(cfg.plot.x, 0, cfg.plot.z), { distance: 20, height: 12 });
          selectHouse(houseId);
        } else if (houseId) {
          toast('House not found — the link may be outdated', 'err', 5000);
        } else {
          // Static opening view: the camera is simply placed, no fly-in and no
          // spring-back on load.
          city.placeAt(new THREE.Vector3(0, 0, 0), { distance: 52, height: 30 });
        }
      }, 250);
    }
  }, 120);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
const timer = new THREE.Timer();
timer.connect(document);
let settleTimer = 0;
let needsUiTimer = 0;
let visualMetricsFrame = 0;

function frame(timestamp) {
  requestAnimationFrame(frame);
  timer.update(timestamp);
  const dt = Math.min(0.05, timer.getDelta());
  visualFrameSamples.push(dt * 1000);
  if (visualFrameSamples.length > 300) visualFrameSamples.shift();
  visualMetricsFrame += 1;
  if (visualMetricsFrame % 120 === 0) {
    visualMetricsOutput.textContent = JSON.stringify(readVisualMetrics());
  }
  updateTweens(dt * 1000);
  bubbles.update(dt, mode === 'city' && !graphMode);

  // settlement hold processing (task4 §10.2) — pending → available
  settleTimer += dt;
  if (settleTimer > 5) {
    settleTimer = 0;
    if (settleDueOrders() > 0) refreshHud();
  }
  // Live needs bars remain visible for the player's home even with no house
  // selected; the larger card mirrors them when it is open.
  needsUiTimer += dt;
  if (needsUiTimer > 2) {
    needsUiTimer = 0;
    if (mode === 'city') refreshHomeVitals();
    if (mode === 'city' && selectedHouseId && !$('house-card').classList.contains('hidden')) renderNeeds();
  }

  if (mode === 'city') {
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    for (const rec of city.houseGroups.values()) {
      const build = rec.cfg.construction;
      if (!build) continue;
      const now = rec.serverClock ? rec.serverClock.at + performance.now() - rec.serverClock.received : Date.now();
      const progress = build.status === 'completed' ? 1 : Math.min(0.96, Math.max(0, (now - build.startedAt) / (build.completesAt - build.startedAt)));
      // Reveal by real part metadata, not by fragile position/order guesses.
      // A house is built floor-by-floor; the roof and everything that belongs to
      // the top floor must appear TOGETHER at the very end so the top floor is
      // never left with a hole in the roof, a lone tall wall, or open space.
      const floorH = 2.5;
      const maxFloorIndex = rec.houseParts.reduce(
        (m, p) => (typeof p.userData.floorIndex === 'number' ? Math.max(m, p.userData.floorIndex) : m), 0);
      const targetFloors = build.targetFloorCount || (maxFloorIndex + 1) || 1;
      const done = build.kind === 'extension' ? (rec.cfg.completedFloorCount || 0) : 0;
      const completedHeight = 0.5 + done * floorH;
      // Fraction of the in-progress top floor that is up (0..1). The roof caps
      // the last slice so it snaps on only once the walls have fully risen.
      const remaining = Math.max(1, targetFloors - done);
      const perFloor = 1 / remaining;
      for (const part of rec.houseParts) {
        const fi = part.userData.floorIndex;
        const isRoof = !!part.userData.roof;
        // Already-finished lower floors (extensions) are always shown.
        if (build.kind === 'extension' && !isRoof
          && ((typeof fi === 'number' && fi < done) || part.position.y < completedHeight - 0.05)) {
          part.visible = true;
          continue;
        }
        // The roof (and top-floor caps) only appear once construction is basically
        // finished, so it never floats over an unfinished storey.
        if (isRoof) { part.visible = progress >= 0.999 || build.status === 'completed'; continue; }
        // Everything else rises with its own floor's slice of the remaining work.
        const floorOfPart = typeof fi === 'number'
          ? fi
          : Math.max(done, Math.min(targetFloors - 1, Math.floor((part.position.y - 0.5) / floorH)));
        const sliceIndex = Math.max(0, floorOfPart - done);
        const threshold = sliceIndex * perFloor;
        part.visible = progress >= threshold;
      }
    }
    updateWasd(dt);
    city.update(dt);
    residents.update(dt);
    renderer.render(city.scene, city.camera);
  } else if (mode === 'builder') {
    const panelHeight = document.querySelector('.builder-panel').getBoundingClientRect().height;
    const availableHeight = Math.max(180, innerHeight - panelHeight);
    renderer.setViewport(0, panelHeight, innerWidth, availableHeight);
    previewCam.aspect = innerWidth / availableHeight;
    previewCam.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    previewControls.update();
    if (previewHouse) {
      for (const p of previewHouse.anim) {
        if (p.userData.spin) p.rotation.z += dt * 0.9;
        if (p.userData.blink && p.material) p.material.emissiveIntensity = 0.7 + Math.sin(timer.getElapsed() * 4) * 0.7;
        if (p.userData.smoke) updateSmoke(p, timer.getElapsed());
      }
    }
    renderer.render(previewScene, previewCam);
  } else {
    renderer.setViewport(0, 0, innerWidth, innerHeight);
    interior.update(dt);
    renderer.render(interior.scene, interior.camera);
  }
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  for (const cam of [city.camera, previewCam, interior.camera]) {
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
  }
});

boot().catch((error) => {
  console.error('Game startup failed:', error?.stack || error?.message || String(error));
  const label = document.querySelector('.loader-text');
  if (label) label.textContent = 'The game could not finish loading. Please check the connection and try again.';
});
frame();
