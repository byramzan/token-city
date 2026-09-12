import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const ACCESS_STORAGE = 'tokencity_family_access_v1';
const decodeError = (error) => new Error(
  (typeof error?.data === 'string' ? error.data : error?.data?.message || error?.data?.code)
  || error?.message || 'The family could not be synchronized.',
);
export function familyAccessFor(accountId) {
  try { return JSON.parse(localStorage.getItem(ACCESS_STORAGE) || '{}')[accountId] || ''; }
  catch { return ''; }
}
export function storeFamilyAccess(accountId, key) {
  const entries = JSON.parse(localStorage.getItem(ACCESS_STORAGE) || '{}');
  entries[accountId] = key;
  localStorage.setItem(ACCESS_STORAGE, JSON.stringify(entries));
  return key;
}
export function newDemoFamilyAccess(accountId) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return storeFamilyAccess(accountId, [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''));
}
export async function walletFamilyAccess(accountId, signature) {
  if (!signature || signature === 'signed' || signature.startsWith('demo_')) {
    throw new Error('This wallet must support message signing to unlock your family.');
  }
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature));
  return storeFamilyAccess(accountId, [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

export function createFamilyClient({ onChange = () => {}, onStatus = () => {} } = {}) {
  let client, identity, unsubscribe, heartbeat, opening, snapshot = null;
  let generation = 0;
  const clientId = `family_${crypto.randomUUID()}`;
  const visibility = () => document.hidden ? 'background' : 'active';
  const args = () => ({ ...identity });
  function receive(value) {
    if (!value) return;
    if (snapshot && value.stateRevision < snapshot.stateRevision) return;
    snapshot = value;
    onStatus('online');
    onChange(value);
  }
  async function mutate(method, extra = {}) {
    if (!client || !identity) throw new Error('Unlock your family before continuing.');
    try {
      const result = await client.mutation(api.households[method], { ...args(), ...extra });
      if (result?.household) receive(result.household);
      else if (result?.needs) receive(result);
      return result;
    } catch (error) { throw decodeError(error); }
  }
  async function presence(mode = visibility()) {
    if (!client || !identity) return;
    try { await mutate('presence', { clientId, visibility: mode }); }
    catch { onStatus('offline'); }
  }
  const visibilityChanged = () => { void presence(); };
  const pageHidden = () => { void presence('offline'); };
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pagehide', pageHidden);

  return {
    get state() { return snapshot; },
    get houseId() { return identity?.houseId; },
    async connect({ accountId, houseId, accessKey }) {
      if (identity?.houseId === houseId && identity?.accessKey === accessKey && opening) return opening;
      this.disconnect();
      const run = generation;
      if (!import.meta.env.VITE_CONVEX_URL) throw new Error('The family server is unavailable.');
      identity = { accountId, houseId, accessKey };
      client = new ConvexClient(import.meta.env.VITE_CONVEX_URL, { unsavedChangesWarning: false });
      onStatus('connecting');
      opening = (async () => {
        const value = await mutate('open', { clientId, visibility: visibility() });
        if (run !== generation || !client) return null;
        receive(value?.household || value);
        unsubscribe = client.onUpdate(api.households.current, args(), receive, (error) => {
          onStatus('offline', decodeError(error).message);
        });
        heartbeat = setInterval(() => { void presence(); }, 30_000);
        return snapshot;
      })();
      try { return await opening; }
      catch (error) { opening = null; onStatus('offline', error.message); throw error; }
    },
    async quote(sellerHouseId, productId) {
      if (!client || !identity) throw new Error('Unlock your family to preview recovery.');
      try { return await client.query(api.households.quote, { ...args(), sellerHouseId, productId }); }
      catch (error) { throw decodeError(error); }
    },
    use(itemId) { return mutate('useItem', { itemId, eventId: `use_${crypto.randomUUID()}` }); },
    complete(serviceId) { return mutate('completeService', { serviceId, eventId: `service_${crypto.randomUUID()}` }); },
    placementFailure(reason, floorId) { return mutate('recordPlacementFailure', { reason, floorId, eventId: `placement_${crypto.randomUUID()}` }); },
    prefer(businessHouseId, preferred) { return mutate('setPreference', { businessHouseId, preferred }); },
    refresh: presence,
    disconnect() {
      generation++;
      clearInterval(heartbeat);
      unsubscribe?.();
      void client?.close();
      client = identity = snapshot = opening = unsubscribe = null;
    },
    stop() {
      this.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pageHidden);
    },
  };
}
