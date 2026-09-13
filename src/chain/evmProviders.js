// EVM wallet discovery for Robinhood Chain (task8 §9.2, §9.3).
//
// Discovery is EIP-6963 first: modern wallets announce themselves instead of
// fighting over `window.ethereum`. Known injected providers are a fallback so a
// wallet that never announces is still usable. A provider is only shown as
// compatible after it has actually answered `eth_chainId`, so a Solana-only
// extension can never be presented as a Robinhood Chain wallet.

import { walletBrandIcon } from '../walletIcons.js';

/**
 * Wallets we explicitly support and test. `find` locates the wallet's own
 * injected object, which gives its native popup rather than a generic one.
 */
export const EVM_WALLETS = Object.freeze([
  {
    id: 'robinhood',
    name: 'Robinhood Wallet',
    color: '#00c805',
    icon: walletBrandIcon('robinhood'),
    url: 'https://robinhood.com/wallet/',
    rdnsMatch: ['com.robinhood', 'robinhood'],
    find: () => window.robinhood?.ethereum || pickInjected((provider) => provider.isRobinhood),
    note: 'Native Robinhood Chain support.',
  },
  {
    id: 'metamask',
    name: 'MetaMask',
    color: '#f6851b',
    icon: walletBrandIcon('metamask'),
    url: 'https://metamask.io/download/',
    rdnsMatch: ['io.metamask'],
    find: () => pickInjected((provider) => provider.isMetaMask && !provider.isBraveWallet && !provider.isRabby),
  },
  {
    id: 'coinbase',
    name: 'Coinbase Wallet',
    color: '#0052ff',
    icon: walletBrandIcon('coinbase'),
    url: 'https://www.coinbase.com/wallet/downloads',
    rdnsMatch: ['com.coinbase'],
    find: () => window.coinbaseWalletExtension || pickInjected((provider) => provider.isCoinbaseWallet),
  },
  {
    id: 'okx',
    name: 'OKX Wallet',
    color: '#000000',
    icon: walletBrandIcon('okx'),
    url: 'https://www.okx.com/web3',
    rdnsMatch: ['com.okex.wallet', 'com.okx.wallet'],
    find: () => window.okxwallet || pickInjected((provider) => provider.isOkxWallet || provider.isOKExWallet),
  },
  {
    id: 'phantom',
    name: 'Phantom',
    color: '#ab9ff2',
    icon: walletBrandIcon('phantom'),
    url: 'https://phantom.com/download',
    rdnsMatch: ['app.phantom'],
    // Only Phantom's EVM account can talk to Robinhood Chain; its Solana
    // provider is a different network entirely and is never used here.
    find: () => window.phantom?.ethereum || null,
    note: 'Uses the Phantom Ethereum account, not the Solana account.',
  },
  {
    id: 'backpack',
    name: 'Backpack',
    color: '#e33e3f',
    icon: walletBrandIcon('backpack'),
    url: 'https://backpack.app/download',
    rdnsMatch: ['app.backpack'],
    find: () => window.backpack?.ethereum || null,
    note: 'Uses the Backpack Ethereum account, not the Solana account.',
  },
]);

function providerList() {
  const root = window.ethereum;
  if (!root) return [];
  return Array.isArray(root.providers) && root.providers.length ? root.providers : [root];
}

function pickInjected(predicate) {
  return providerList().find((provider) => {
    try { return Boolean(predicate(provider)); } catch { return false; }
  }) || null;
}

const announced = new Map();   // rdns -> { info, provider }
let listening = false;

/** Start listening for EIP-6963 announcements. Safe to call repeatedly. */
export function startProviderDiscovery() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('eip6963:announceProvider', (event) => {
    const detail = event.detail;
    if (detail?.info?.rdns && detail.provider) announced.set(detail.info.rdns, detail);
  });
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

function announcedFor(wallet) {
  for (const [rdns, detail] of announced) {
    if (wallet.rdnsMatch.some((match) => rdns.toLowerCase().includes(match.toLowerCase()))) return detail;
  }
  return null;
}

/** Every wallet the page can offer, with its live provider when installed. */
export function discoverEvmWallets() {
  startProviderDiscovery();
  const known = EVM_WALLETS.map((wallet) => {
    const detail = announcedFor(wallet);
    const provider = detail?.provider || wallet.find?.() || null;
    return {
      ...wallet,
      icon: wallet.icon,
      name: detail?.info?.name || wallet.name,
      provider,
      installed: Boolean(provider),
      source: detail ? 'eip6963' : provider ? 'injected' : 'none',
    };
  });
  // Any other announced wallet is offered too — the standard exists so the game
  // does not need a hard-coded list to stay usable.
  const extra = [];
  for (const [rdns, detail] of announced) {
    if (known.some((wallet) => wallet.rdnsMatch.some((match) => rdns.toLowerCase().includes(match.toLowerCase())))) continue;
    extra.push({
      id: `eip6963:${rdns}`,
      name: detail.info.name,
      color: '#7a8aa5',
      icon: detail.info.icon,
      url: '',
      provider: detail.provider,
      installed: true,
      source: 'eip6963',
    });
  }
  return [...known, ...extra];
}

/**
 * WalletConnect is loaded only when a project id is configured and the user
 * chooses it, so no mobile-bridge bundle is downloaded by default.
 */
export async function connectWalletConnect({ projectId, chain, metadata }) {
  if (!projectId) throw new Error('WalletConnect is not configured for this deployment.');
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  const provider = await EthereumProvider.init({
    projectId,
    chains: [chain.chainId],
    optionalChains: [chain.chainId],
    showQrModal: true,
    rpcMap: { [chain.chainId]: chain.publicRpcUrl },
    metadata,
  });
  await provider.enable();
  return provider;
}
