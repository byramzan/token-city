import { ConvexClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const STATE_SAVED_EVENT = 'tokencity:state-saved';
const REQUEST_TIMEOUT = 12_000;
const READY_TIMEOUT = 8_000;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutServerFields(document) {
  const value = clone(document);
  delete value.version;
  delete value.updatedAt;
  delete value.originClientId;
  delete value.eventId;
  delete value.stateRevision;
  delete value.serverTimestamp;
  // A no-op save answers with the canonical document plus a result marker
  // (task8 §21.4). The marker is not part of the document identity.
  delete value.status;
  delete value.revision;
  // Resident needs, social links and simulated storefront stock change every
  // few seconds in each browser. They are intentionally local simulation state;
  // syncing them would make idle tabs fight over the same house revision.
  delete value.needs;
  delete value.links;
  delete value.business;
  return value;
}

function fingerprint(document) {
  return JSON.stringify(withoutServerFields(document));
}

function tabClientId() {
  // sessionStorage is cloned by browsers when a tab is duplicated. A fresh
  // runtime ID prevents the duplicate from discarding the original tab's
  // realtime events as if they were its own writes.
  const id = `client_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  return id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function failureFrom(error, fallback = 'multiplayer-request-failed') {
  const data = error?.data;
  const code = typeof data === 'string' ? data : data?.code;
  const failure = new Error(code || fallback);
  failure.document = typeof data === 'object' ? data.document || null : null;
  return failure;
}

function withTimeout(promise, fallback = 'multiplayer-timeout') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(fallback)), REQUEST_TIMEOUT)),
  ]);
}

export function createWorldMultiplayer({
  getDocuments,
  getAccessKey = () => '',
  canSyncDocument = () => true,
  onSnapshot,
  onHouseUpsert,
  onTrade,
  onStatus,
}) {
  const clientId = tabClientId();
  const known = new Map();
  const deploymentUrl = import.meta.env.VITE_CONVEX_URL;
  let client = null;
  let unsubscribeWorld = null;
  let unsubscribeTrades = null;
  let unsubscribeConnection = null;
  let stopped = false;
  let connected = false;
  let snapshotReady = false;
  let flushTimer = null;
  let startPromise = null;
  const knownTrades = new Set();
  let tradesReady = false;
  const writes = new Map();

  function serial(houseId, action) {
    const previous = writes.get(houseId) || Promise.resolve();
    const pending = previous.catch(() => {}).then(action);
    writes.set(houseId, pending);
    void pending.finally(() => { if (writes.get(houseId) === pending) writes.delete(houseId); }).catch(() => {});
    return pending;
  }

  async function mutateRetry(method, args) {
    if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
    try {
      let result;
      try { result = await withTimeout(client.mutation(api.world[method], args)); }
      catch (error) {
        if (error.message !== 'multiplayer-timeout') throw error;
        result = await withTimeout(client.mutation(api.world[method], args));
      }
      return clone(result);
    } catch (error) {
      if (error.message === 'multiplayer-timeout') throw error;
      throw failureFrom(error, error.message);
    }
  }

  function saveHouse(document, { basePlacementsRevision } = {}) {
    return serial(document.house.id, async () => {
      const record = known.get(document.house.id);
      if (!record) throw new Error('house-not-synchronized');
      try {
        const canonical = await mutateRetry('update', {
          clientId, document: clone(document), baseVersion: record.version,
          basePlacementsRevision: basePlacementsRevision ?? record.placementsRevision,
          accessKey: getAccessKey(document.house.owner),
        });
        remember(canonical);
        onHouseUpsert?.(clone(canonical));
        return canonical;
      } catch (error) {
        if (error.document) { remember(error.document); onHouseUpsert?.(clone(error.document)); }
        throw error;
      }
    });
  }

  function setStatus(status) {
    onStatus?.(status);
  }

  function remember(document) {
    known.set(document.house.id, {
      version: Number(document.version) || 0,
      fingerprint: fingerprint(document),
      placementsRevision: Number(document.placements?.revision) || 0,
    });
  }

  function applyDocuments(documents) {
    const list = Array.isArray(documents) ? documents.map(clone) : [];
    if (!snapshotReady) {
      known.clear();
      list.forEach(remember);
      onSnapshot?.(list);
      snapshotReady = true;
      setStatus(connected ? 'online' : 'offline');
      return;
    }
    const incomingIds = new Set(list.map((document) => document?.house?.id).filter(Boolean));
    if ([...known.keys()].some((houseId) => !incomingIds.has(houseId))) {
      known.clear();
      list.forEach(remember);
      onSnapshot?.(list);
      return;
    }
    for (const document of list) {
      if (!document?.house?.id) continue;
      const record = known.get(document.house.id);
      if (record && Number(document.version || 0) < record.version) continue;
      const changed = !record
        || record.version !== Number(document.version || 0)
        || record.fingerprint !== fingerprint(document);
      remember(document);
      if (changed) onHouseUpsert?.(document);
    }
  }

  async function flushChanges() {
    if (!client || !connected || !snapshotReady) return;
    for (const document of getDocuments()) {
      if (!canSyncDocument(document)) continue;
      if (writes.has(document.house.id) || !getAccessKey(document.house.owner)) continue;
      const record = known.get(document.house.id);
      if (!record || record.fingerprint === fingerprint(document)) continue;
      try {
        await saveHouse(document);
      } catch (error) {
        const failure = failureFrom(error, error?.message || 'multiplayer-request-failed');
        if (failure.document) {
          remember(failure.document);
          onHouseUpsert?.(clone(failure.document));
        }
      }
    }
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { void flushChanges(); }, 300);
  }

  addEventListener(STATE_SAVED_EVENT, scheduleFlush);

  return {
    start() {
      if (startPromise) return startPromise;
      startPromise = (async () => {
        if (!deploymentUrl) {
          setStatus('offline');
          return false;
        }
        stopped = false;
        setStatus('connecting');
        const localDocuments = getDocuments().map(clone);
        client = new ConvexClient(deploymentUrl, { unsavedChangesWarning: false });
        unsubscribeConnection = client.client.subscribeToConnectionState((state) => {
          connected = Boolean(state.isWebSocketConnected);
          if (stopped) return;
          setStatus(connected ? (snapshotReady ? 'online' : 'syncing') : 'offline');
        });
        try {
          await withTimeout(client.mutation(api.world.join, { clientId, documents: localDocuments }));
        } catch (error) {
          setStatus('offline');
          return false;
        }
        return new Promise((resolve) => {
          let settled = false;
          const finish = (ready) => {
            if (settled) return;
            settled = true;
            resolve(ready);
          };
          unsubscribeWorld = client.onUpdate(
            api.world.list,
            {},
            (documents) => {
              applyDocuments(documents);
              finish(true);
            },
            () => {
              if (!snapshotReady) finish(false);
              setStatus('offline');
            },
          );
          unsubscribeTrades = client.onUpdate(
            api.world.recentTrades,
            {},
            (trades) => {
              const replay = !tradesReady;
              for (const trade of Array.isArray(trades) ? trades : []) {
                const tradeId = String(trade?._id || trade?.purchaseKey || '');
                if (!tradeId || knownTrades.has(tradeId)) continue;
                knownTrades.add(tradeId);
                onTrade?.(clone({ ...trade, id: tradeId }), { replay });
              }
              tradesReady = true;
            },
          );
          setTimeout(() => finish(false), READY_TIMEOUT);
        });
      })();
      return startPromise;
    },
    isOnline: () => connected && snapshotReady,
    // The chain service reuses this connection rather than opening a second
    // WebSocket: private deposit and withdrawal events ride the same socket as
    // the house and business feed (task8 §16.3).
    convexClient: () => client,
    saveHouse,
    async addFloor(args) {
      const result = await mutateRetry('addFloor', { clientId, ...args, accessKey: getAccessKey(args.accountId) });
      if (result.document) { remember(result.document); onHouseUpsert?.(clone(result.document)); }
      return result;
    },
    completeConstruction(args) { return mutateRetry('completeConstruction', { ...args, accessKey: getAccessKey(args.accountId) }); },
    purchaseEmergency(args) { return mutateRetry('purchaseEmergency', { clientId, ...args, accessKey: getAccessKey(args.accountId) }); },
    async createHouse(document) {
      if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
      try {
        const canonical = await withTimeout(client.mutation(api.world.create, {
          clientId,
          document: clone(document),
          accessKey: getAccessKey(document.house.owner),
        }));
        remember(canonical);
        return clone(canonical);
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async publishBusiness({ accountId, houseId, business }) {
      if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
      const record = known.get(houseId);
      if (!record) throw new Error('house-not-synchronized');
      try {
        const canonical = await withTimeout(client.mutation(api.world.setBusiness, {
          clientId,
          accountId,
          accessKey: getAccessKey(accountId),
          houseId,
          business: clone(business),
          baseVersion: record.version,
        }));
        remember(canonical);
        return clone(canonical);
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async changeBusiness({ accountId, houseId, business = null, action, productId, amount, value }) {
      if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
      const operationId = `bizop_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
        .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const args = {
        clientId,
        operationId,
        accountId,
        accessKey: getAccessKey(accountId),
        houseId,
        action,
        ...(business ? { business: clone(business) } : {}),
        ...(productId ? { productId } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(value !== undefined ? { value } : {}),
      };
      const request = () => withTimeout(client.mutation(api.world.changeBusiness, args));
      try {
        let result;
        try { result = await request(); }
        catch (error) {
          // A timed-out mutation may already have committed. Retry the same
          // operation ID so the server returns the original atomic result.
          if (error?.message !== 'multiplayer-timeout') throw error;
          result = await request();
        }
        if (result?.document) remember(result.document);
        return clone(result);
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async purchaseProduct({ buyerId, householdId, houseId, productId, purchaseKey, expectedPrice, fee }) {
      if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
      try {
        const result = await mutateRetry('purchaseProduct', {
          clientId,
          buyerId,
          householdId,
          accessKey: getAccessKey(buyerId),
          houseId,
          productId,
          purchaseKey,
          expectedPrice,
          fee,
        });
        if (result?.document) remember(result.document);
        return clone(result);
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async beginPaymentSession({ accountId, walletAddress, quoteId, coins, tokens }) {
      if (!client || !connected || !snapshotReady) throw new Error('multiplayer-offline');
      const sessionId = `pay_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`
        .replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      try {
        return clone(await withTimeout(client.mutation(api.world.beginPayment, {
          clientId,
          sessionId,
          accountId,
          walletAddress,
          quoteId,
          coins,
          tokens,
        })));
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async completePaymentSession({ sessionId, accountId, signature }) {
      if (!client || !connected) throw new Error('multiplayer-offline');
      try {
        return clone(await withTimeout(client.mutation(api.world.completePayment, {
          sessionId, accountId, signature,
        })));
      } catch (error) {
        if (error?.message === 'multiplayer-timeout') throw error;
        throw failureFrom(error);
      }
    },
    async cancelPaymentSession({ sessionId, accountId, reason }) {
      if (!client || !connected || !sessionId || !accountId) return null;
      try {
        return clone(await withTimeout(client.mutation(api.world.cancelPayment, {
          sessionId, accountId, reason,
        })));
      } catch { return null; }
    },
    async requestSnapshot() {
      if (!client || !connected) throw new Error('multiplayer-offline');
      const documents = await withTimeout(client.query(api.world.list, {}));
      applyDocuments(documents);
      return clone(documents);
    },
    syncNow: flushChanges,
    stop() {
      stopped = true;
      connected = false;
      snapshotReady = false;
      clearTimeout(flushTimer);
      unsubscribeWorld?.();
      unsubscribeTrades?.();
      unsubscribeConnection?.();
      void client?.close();
      client = null;
      removeEventListener(STATE_SAVED_EVENT, scheduleFlush);
    },
  };
}
