import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { FAMILY_BUSINESSES } from '../server/familyRules.js';
import { buildHouseDefinition, defaultResidentialObjects } from '../src/houseModel.js';

const clients = [0, 1].map(() => new ConvexClient(process.env.VITE_CONVEX_URL, { unsavedChangesWarning: false }));
const tag = Date.now().toString(36);
const homes = [0, 1].map((i) => ({ id: `verify_family_${tag}_${i}`, owner: `verify_owner_${tag}_${i}`, key: randomBytes(32).toString('hex') }));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const access = (i) => ({ accountId: homes[i].owner, houseId: homes[i].id, accessKey: homes[i].key });
const calls = [];
let unsubscribe;
try {
  const existing = await clients[0].query(api.world.list, {});
  const taken = new Set(existing.map((entry) => entry.house.plot.i));
  const plots = Array.from({ length: 100 }, (_, i) => i).filter((i) => !taken.has(i));
  unsubscribe = clients[1].onUpdate(api.world.list, {}, (state) => { calls.push(state); });
  for (let i = 0; i < 2; i++) {
    const house = { id: homes[i].id, owner: homes[i].owner, name: `Family QA ${tag} ${i}`, nickname: 'QA', foundation: 'compact',
      height: 'one', floorCount: i ? 1 : 5, material: 'wood', roof: 'gable', kit: 'cozy', layout: 'balanced', detail: 'none', scheme: 'warm',
      builtAt: Date.now(), plot: { i: plots[i], x: 90 + i * 10, z: 90 }, schemaVersion: 4 };
    const definition = buildHouseDefinition(house);
    const doc = { house, definition, placements: { revision: 0, objects: defaultResidentialObjects(definition) }, interior: { slots: {}, yard: {} }, business: null };
    homes[i].document = await clients[i].mutation(api.world.create, { clientId: `verify_client_${i}`, document: doc, accessKey: homes[i].key });
    assert.equal(homes[i].document.house.residentCount, 0);
    assert.equal(homes[i].document.house.construction.status, 'building');
    const duplicate = await clients[i].mutation(api.world.create, { clientId: `verify_client_${i}`, document: doc, accessKey: homes[i].key });
    assert.equal(duplicate.version, homes[i].document.version);
  }
  await sleep(13000);
  let world = await clients[1].query(api.world.list, {});
  for (let i = 0; i < 2; i++) {
    const home = world.find((entry) => entry.house.id === homes[i].id);
    assert.equal(home.house.residentCount, i ? 4 : 12);
    const family = await clients[i].mutation(api.households.open, { ...access(i), clientId: `verify_presence_${i}`, visibility: 'active' });
    assert.equal(family.residentCount, i ? 4 : 12);
    assert.equal(family.needs.hunger > 99, true);
    assert.equal(home.needs, null);
  }
  assert.ok(calls.some((world) => world.some((entry) => entry.house.id === homes[0].id && entry.house.residentCount === 12)));
  const extensionId = `verify_extend_${tag}`;
  const addArgs = { ...access(1), clientId: 'verify_extend', eventId: extensionId, baseFloorCount: 1 };
  const extension = await clients[1].mutation(api.world.addFloor, addArgs);
  assert.equal(extension.document.house.residentCount, 4);
  assert.equal(extension.document.house.floorCount, 2);
  const repeated = await clients[1].mutation(api.world.addFloor, addArgs);
  assert.equal(repeated.duplicate, true);
  await sleep(6500);
  const seller = (await clients[0].query(api.world.list, {})).find((entry) => entry.house.id === homes[1].id);
  assert.equal(seller.house.residentCount, 6);
  const catalog = FAMILY_BUSINESSES.grocery;
  const business = { type: 'grocery', level: 1, stock: Object.fromEntries(catalog.products.map((p) => [p.id, 9])),
    prices: Object.fromEntries(catalog.products.map((p) => [p.id, p.price])), status: 'open' };
  const businessResult = await clients[1].mutation(api.world.changeBusiness, { ...access(1), clientId: 'verify_biz', operationId: `verify_biz_${tag}`, action: 'create', business });
  assert.equal(businessResult.applied, true);
  const product = catalog.products[0];
  const quote = await clients[0].query(api.households.quote, { ...access(0), sellerHouseId: homes[1].id, productId: product.id });
  assert.equal(quote.allowed, true);
  assert.equal(quote.partial, true);
  const purchase = { buyerId: homes[0].owner, householdId: homes[0].id, houseId: homes[1].id, accessKey: homes[0].key,
    clientId: 'verify_purchase', productId: product.id, purchaseKey: `verify_purchase_${tag}`, expectedPrice: quote.price, fee: 1 };
  const sale = await clients[0].mutation(api.world.purchaseProduct, purchase);
  assert.equal(sale.household.inventory.length, 1);
  assert.equal(sale.document.business.stock[product.id], 9 - product.stockUnits);
  const duplicateSale = await clients[0].mutation(api.world.purchaseProduct, purchase);
  assert.equal(duplicateSale.duplicate, true);
  assert.equal(duplicateSale.household.inventory.length, 1);
  const use = { ...access(0), itemId: sale.household.inventory[0].id, eventId: `verify_use_${tag}` };
  const recovered = await clients[0].mutation(api.households.useItem, use);
  assert.equal(recovered.household.inventory.length, 0);
  assert.equal((await clients[0].mutation(api.households.useItem, use)).duplicate, true);
  const current = (await clients[1].query(api.world.list, {})).find((entry) => entry.house.id === homes[0].id);
  const objects = current.placements.objects.slice(1);
  const edited = { ...current, placements: { ...current.placements, revision: current.placements.revision + 1, objects },
    interiorInventory: [current.placements.objects[0].itemId] };
  const saved = await clients[0].mutation(api.world.update, { clientId: 'verify_save', document: edited, baseVersion: current.version,
    basePlacementsRevision: current.placements.revision, accessKey: homes[0].key });
  for (let i = 0; i < 60 && !calls.some((world) => world.some((entry) => entry.house.id === homes[0].id && entry.version >= saved.version)); i++) await sleep(50);
  const other = calls.at(-1).find((entry) => entry.house.id === homes[0].id);
  assert.deepEqual(other.placements.objects, saved.placements.objects);
  assert.deepEqual(other.interiorInventory, saved.interiorInventory);
  console.log(JSON.stringify({ passed: true, websocketSnapshots: calls.length,
    checks: ['five-floor construction', 'completion resident counts', 'creation replay', 'floor extension replay', 'private household', 'family coverage quote', 'stock purchase', 'duplicate purchase', 'product use once', 'deterministic interior reload'] }));
} finally {
  unsubscribe?.();
  for (const home of homes) await clients[0].mutation(api.world.removeVerificationHouse, { houseId: home.id }).catch(() => {});
  await Promise.all(clients.map((client) => client.close()));
}
