import { walletBrandIcon, isLocalWalletIcon } from './walletIcons.js';
import { getWallets } from '@wallet-standard/app';
import { StandardWalletAdapter } from '@solana/wallet-standard-wallet-adapter-base';

// Wallet Standard discovers modern extensions that do not expose window.*.
// A known wallet's own injected provider is preferred for its native popup.

const STANDARD_CONNECT = 'standard:connect';
const STANDARD_EVENTS = 'standard:events';
const SOLANA_SIGN_TRANSACTION = 'solana:signTransaction';
const SOLANA_SIGN_AND_SEND_TRANSACTION = 'solana:signAndSendTransaction';
const WALLET_OPERATION_LOCK = 'token-city:wallet-operation';
const WALLET_OPERATION_STORAGE_KEY = 'token_city_wallet_operation_v1';
const WALLET_OPERATION_TTL = 90_000;

let walletOperationInFlight = false;
const walletTabId = globalThis.crypto?.randomUUID?.()
  || `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;


export const WALLET_PROVIDERS = [
  {
    id: 'phantom', name: 'Phantom', aliases: ['phantom'], color: '#ab9ff2',
    icon: walletBrandIcon('phantom'), tags: ['browser', 'mobile', 'solana'],
    url: 'https://phantom.com/download',
    detect: () => !!(window.phantom?.solana?.isPhantom || window.solana?.isPhantom),
    adapter: () => window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null),
  },
  {
    id: 'solflare', name: 'Solflare', aliases: ['solflare'], color: '#fc7227',
    icon: walletBrandIcon('solflare'), tags: ['browser', 'mobile', 'solana'],
    url: 'https://solflare.com/download',
    detect: () => !!window.solflare?.isSolflare,
    adapter: () => window.solflare || null,
  },
  {
    id: 'backpack', name: 'Backpack', aliases: ['backpack'], color: '#e33e3f',
    icon: walletBrandIcon('backpack'), tags: ['browser', 'mobile', 'solana'],
    url: 'https://backpack.app/download',
    detect: () => !!(window.backpack?.isBackpack || window.xnft?.solana),
    adapter: () => window.backpack || window.xnft?.solana || null,
  },
  {
    id: 'jupiter', name: 'Jupiter Mobile', aliases: ['jupiter', 'jup mobile'], color: '#00bef0',
    icon: walletBrandIcon('jupiter'), tags: ['mobile', 'solana'],
    url: 'https://jup.ag/mobile',
    detect: () => !!window.jupiter?.solana,
    adapter: () => window.jupiter?.solana || null,
  },
  {
    id: 'coinbase', name: 'Coinbase Wallet', aliases: ['coinbase'], color: '#0052ff',
    icon: walletBrandIcon('coinbase'), tags: ['browser', 'mobile', 'solana'],
    url: 'https://www.coinbase.com/wallet/downloads',
    detect: () => !!(window.coinbaseSolana || window.coinbaseWalletExtension?.solana),
    adapter: () => window.coinbaseSolana || window.coinbaseWalletExtension?.solana || null,
  },
  {
    id: 'okx', name: 'OKX Wallet', aliases: ['okx'], color: '#121212',
    icon: walletBrandIcon('okx'), tags: ['browser', 'mobile', 'solana'],
    url: 'https://web3.okx.com/download',
    detect: () => !!window.okxwallet?.solana,
    adapter: () => window.okxwallet?.solana || null,
  },
  {
    id: 'metamask', name: 'MetaMask', aliases: ['metamask'], color: '#f6851b',
    icon: walletBrandIcon('metamask'), tags: ['browser', 'mobile', 'solana snap'],
    url: 'https://metamask.io/download/',
    // A plain EVM MetaMask provider is deliberately not treated as Solana-ready.
    // A Solana-capable MetaMask/Snap registers through Wallet Standard.
    detect: () => !!window.metamask?.solana,
    adapter: () => window.metamask?.solana || null,
  },
];

const registry = typeof window !== 'undefined' ? getWallets() : null;
const standardAdapters = new WeakMap();

export function isSolanaStandardWallet(wallet) {
  const features = wallet?.features || {};
  return !!(
    features[STANDARD_CONNECT]
    && features[STANDARD_EVENTS]
    && (features[SOLANA_SIGN_TRANSACTION] || features[SOLANA_SIGN_AND_SEND_TRANSACTION])
  );
}

export function walletMatchesProvider(wallet, provider) {
  const name = String(wallet?.name || '').trim().toLowerCase();
  return !!name && (provider.aliases || [provider.name]).some((alias) => name.includes(alias.toLowerCase()));
}

export function safeWalletIcon(value, fallback = '') {
  const icon = String(value || '');
  if (isLocalWalletIcon(icon)) return icon;
  if (/^data:image\/(?:svg\+xml|png|webp|gif);base64,[a-z0-9+/=]+$/i.test(icon)) return icon;
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s"'<>]*)?$/i.test(icon)) return icon;
  return fallback;
}

function walletErrorText(error) {
  const parts = [];
  const seen = new Set();
  let current = error;
  for (let depth = 0; current != null && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === 'string') parts.push(current);
    else {
      if (current.message) parts.push(current.message);
      if (current.name) parts.push(current.name);
      if (current.code != null) parts.push(String(current.code));
      current = current.cause;
      continue;
    }
    break;
  }
  return parts.join(' ').toLowerCase();
}

/** Converts extension-specific failures into stable UI states. */
export function walletErrorKind(error) {
  const text = walletErrorText(error);
  if (text.includes('wallet-busy')) return 'wallet-busy';
  if (
    text.includes('extension context invalidated')
    || text.includes('failed to send message to service worker')
    || text.includes('receiving end does not exist')
    || text.includes('could not establish connection')
    || text.includes('message port closed')
    || text.includes('disconnected port object')
  ) return 'extension-stale';
  if (
    text.includes('user rejected')
    || text.includes('user declined')
    || text.includes('request rejected')
    || text.includes('signature rejected')
    || /(?:^|\s)4001(?:\s|$)/.test(text)
  ) return 'user-rejected';
  return 'unknown';
}

function storageForWalletLock() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

async function withStorageWalletLock(operation) {
  const storage = storageForWalletLock();
  if (!storage) return operation();
  const now = Date.now();
  try {
    const active = JSON.parse(storage.getItem(WALLET_OPERATION_STORAGE_KEY) || 'null');
    if (active?.owner !== walletTabId && Number(active?.expiresAt) > now) {
      throw new Error('wallet-busy');
    }
  } catch (error) {
    if (error?.message === 'wallet-busy') throw error;
  }

  storage.setItem(WALLET_OPERATION_STORAGE_KEY, JSON.stringify({
    owner: walletTabId,
    expiresAt: now + WALLET_OPERATION_TTL,
  }));
  try {
    const claimed = JSON.parse(storage.getItem(WALLET_OPERATION_STORAGE_KEY) || 'null');
    if (claimed?.owner !== walletTabId) throw new Error('wallet-busy');
    return await operation();
  } finally {
    try {
      const active = JSON.parse(storage.getItem(WALLET_OPERATION_STORAGE_KEY) || 'null');
      if (active?.owner === walletTabId) storage.removeItem(WALLET_OPERATION_STORAGE_KEY);
    } catch { /* storage access can be revoked in private browser contexts */ }
  }
}

/** Ensures only one My Hood tab can ask an extension for approval at a time. */
export async function withWalletOperationLock(operation) {
  if (typeof operation !== 'function') throw new TypeError('wallet-operation-required');
  if (walletOperationInFlight) throw new Error('wallet-busy');
  walletOperationInFlight = true;
  try {
    if (globalThis.navigator?.locks?.request) {
      return await globalThis.navigator.locks.request(
        WALLET_OPERATION_LOCK,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error('wallet-busy');
          return operation();
        },
      );
    }
    return await withStorageWalletLock(operation);
  } finally {
    walletOperationInFlight = false;
  }
}

function standardWallets() {
  return (registry?.get() || []).filter(isSolanaStandardWallet);
}

function adapterForStandardWallet(wallet) {
  let adapter = standardAdapters.get(wallet);
  if (!adapter) {
    adapter = new StandardWalletAdapter({ wallet });
    // Wallet adapters emit their errors as events as well as rejected promises.
    // Subscribing prevents an EventEmitter 'error' event becoming uncaught.
    adapter.on('error', () => {});
    standardAdapters.set(wallet, adapter);
  }
  return adapter;
}

function safeDetect(provider) {
  try { return !!provider.detect?.(); } catch { return false; }
}

function slug(value) {
  return String(value || 'wallet').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'wallet';
}

export function providerCatalog() {
  const discovered = standardWallets();
  const used = new Set();
  const configured = WALLET_PROVIDERS.map((provider) => {
    const standardWallet = discovered.find((wallet) => !used.has(wallet) && walletMatchesProvider(wallet, provider));
    if (standardWallet) used.add(standardWallet);
    const legacyInstalled = safeDetect(provider);
    return {
      ...provider,
      installed: !!standardWallet || legacyInstalled,
      // Known injected providers use their own connection window. Wallet Standard
      // stays as the discovery/fallback path for providers without an injection.
      source: legacyInstalled ? 'legacy' : standardWallet ? 'wallet-standard' : 'catalog',
      icon: provider.icon,
      adapter: legacyInstalled
        ? provider.adapter
        : standardWallet ? () => adapterForStandardWallet(standardWallet) : provider.adapter,
    };
  });

  const dynamicIds = new Map();
  const additional = discovered.filter((wallet) => !used.has(wallet)).map((wallet) => {
    const base = `standard-${slug(wallet.name)}`;
    const count = (dynamicIds.get(base) || 0) + 1;
    dynamicIds.set(base, count);
    return {
      id: count === 1 ? base : `${base}-${count}`,
      name: wallet.name,
      aliases: [wallet.name],
      color: '#6f63d9',
      icon: safeWalletIcon(wallet.icon),
      tags: ['installed', 'wallet standard', 'solana'],
      url: '',
      installed: true,
      source: 'wallet-standard',
      adapter: () => adapterForStandardWallet(wallet),
    };
  });

  return [...additional, ...configured];
}

export function providerById(id) {
  return providerCatalog().find((provider) => provider.id === id) || null;
}

export function providerIcon(id) {
  const provider = providerById(id);
  return safeWalletIcon(provider?.icon, '');
}

/** Search by name, availability and platform. Installed wallets are first. */
export function filterProviders(query) {
  const q = (query || '').trim().toLowerCase();
  let list = providerCatalog();
  if (q) {
    list = list.filter((provider) =>
      provider.name.toLowerCase().includes(q)
      || provider.tags.some((tag) => tag.includes(q))
      || (q === 'installed' && provider.installed));
  }
  return list.sort((a, b) => Number(b.installed) - Number(a.installed));
}

export function subscribeProviderChanges(listener) {
  if (!registry) return () => {};
  const notify = () => listener(providerCatalog());
  const offRegister = registry.on('register', notify);
  const offUnregister = registry.on('unregister', notify);
  return () => { offRegister(); offUnregister(); };
}

export function openProviderPage(id) {
  const provider = providerById(id);
  if (!provider?.url) throw new Error('no-provider-page');
  window.open(provider.url, '_blank', 'noopener,noreferrer');
}

/** Connects only to an installed Solana provider; it never redirects. */
export async function connectProvider(id, { lock = true } = {}) {
  const connect = async () => {
    // Resolve at click time so an extension reload does not leave us using an
    // adapter object captured by an earlier render.
    const provider = providerById(id);
    if (!provider) throw new Error('unknown-provider');
    if (!provider.installed) throw new Error('not-installed');
    const adapter = provider.adapter?.();
    if (!adapter?.connect) throw new Error('no-adapter');
    const result = await adapter.connect();
    const key = result?.publicKey || adapter.publicKey;
    if (!key) throw new Error('no-public-key');
    return { address: key.toString(), adapter, provider };
  };
  return lock ? withWalletOperationLock(connect) : connect();
}

export function buildChallenge(accountId, address) {
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = [...nonceBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    domain: location.host || 'tokencity.local',
    accountId,
    wallet: address,
    nonce,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
    network: 'solana',
    purpose: 'link wallet',
  };
}

export async function signChallenge(adapter, challenge) {
  const message = JSON.stringify(challenge);
  try {
    if (adapter?.signMessage) {
      const bytes = new TextEncoder().encode(message);
      const signed = await adapter.signMessage(bytes, 'utf8');
      const signature = signed?.signature || signed;
      const raw = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
      return {
        signature: raw.length ? btoa(String.fromCharCode(...raw)) : 'signed',
        verified: true,
      };
    }
  } catch (error) {
    const kind = walletErrorKind(error);
    if (kind === 'extension-stale' || kind === 'wallet-busy') {
      throw new Error(kind, { cause: error });
    }
    throw new Error('signature-rejected', { cause: error });
  }
  return { signature: `demo_${challenge.nonce}`, verified: true, demo: true };
}
