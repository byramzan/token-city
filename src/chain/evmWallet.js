// EIP-1193 wallet session for Robinhood Chain (task8 §9, §10, §11.3, §11.4).
//
// Users connect a wallet. The game never receives a private key, a recovery
// phrase or a keystore file, and never asks for one. Everything below is either
// a read or an unsigned request the wallet itself decides to sign.

import { encodeFunctionData, formatUnits } from 'viem';
import { ERC20_ABI, DEPOSIT_VAULT_ABI } from '../../server/chain/abi.js';
import { normalizeEvmAddress, sameAddress, toBigInt } from '../../server/chain/evm.js';
import { walletNetworkMetadata } from '../../server/chain/networks.js';
import { discoverEvmWallets, connectWalletConnect, startProviderDiscovery } from './evmProviders.js';

export { discoverEvmWallets, startProviderDiscovery };

export const WALLET_ERRORS = Object.freeze({
  USER_REJECTED: 'user-rejected',
  WRONG_CHAIN: 'wrong-chain',
  CHAIN_UNKNOWN: 'chain-unknown',
  LOCKED: 'wallet-locked',
  NO_ACCOUNT: 'no-account',
  DISCONNECTED: 'wallet-disconnected',
  PROVIDER: 'provider-error',
});

/** EIP-1193 error codes worth telling apart in the UI (§23). */
export function classifyWalletError(error) {
  const code = error?.code ?? error?.cause?.code;
  const message = String(error?.message || '').toLowerCase();
  if (code === 4001 || message.includes('user rejected') || message.includes('user denied')) return WALLET_ERRORS.USER_REJECTED;
  if (code === 4902 || message.includes('unrecognized chain')) return WALLET_ERRORS.CHAIN_UNKNOWN;
  if (code === 4900 || code === 4901) return WALLET_ERRORS.DISCONNECTED;
  if (message.includes('locked')) return WALLET_ERRORS.LOCKED;
  return WALLET_ERRORS.PROVIDER;
}

export function walletErrorMessage(error, { networkName = 'Robinhood Chain' } = {}) {
  switch (classifyWalletError(error)) {
    case WALLET_ERRORS.USER_REJECTED: return 'You cancelled the request in your wallet.';
    case WALLET_ERRORS.CHAIN_UNKNOWN: return `Your wallet does not know ${networkName} yet. Approve the “add network” request and try again.`;
    case WALLET_ERRORS.DISCONNECTED: return 'The wallet is not connected to this site any more. Reconnect and try again.';
    case WALLET_ERRORS.LOCKED: return 'Unlock your wallet and try again.';
    default: return error?.shortMessage || error?.message || 'The wallet could not complete this request.';
  }
}

const hexChainId = (chainId) => `0x${Number(chainId).toString(16)}`;

/**
 * One connected wallet. The session owns the provider listeners and clears
 * pending state whenever the account or chain changes (§9.5).
 */
export class EvmWalletSession {
  constructor({ provider, providerType, network }) {
    this.provider = provider;
    this.providerType = providerType;
    this.network = network;
    this.address = null;
    this.chainId = null;
    this.listeners = new Set();
    this._handlers = {
      accountsChanged: (accounts) => {
        const next = accounts?.[0] ? normalizeEvmAddress(accounts[0]) : null;
        const changed = !sameAddress(next, this.address);
        this.address = next;
        if (changed) this.#emit({ type: next ? 'accountsChanged' : 'disconnected', address: next });
      },
      chainChanged: (chainId) => {
        this.chainId = Number(chainId);
        this.#emit({ type: 'chainChanged', chainId: this.chainId, correct: this.onCorrectChain() });
      },
      disconnect: () => {
        this.address = null;
        this.#emit({ type: 'disconnected', address: null });
      },
    };
    for (const [event, handler] of Object.entries(this._handlers)) this.provider.on?.(event, handler);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* a UI listener must not break the session */ }
    }
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy() {
    for (const [event, handler] of Object.entries(this._handlers)) this.provider.removeListener?.(event, handler);
    this.listeners.clear();
  }

  request(method, params = []) {
    return this.provider.request({ method, params });
  }

  onCorrectChain() {
    return Number(this.chainId) === Number(this.network.chainId);
  }

  async connect() {
    const accounts = await this.request('eth_requestAccounts');
    if (!accounts?.length) throw Object.assign(new Error('This wallet returned no account.'), { code: 4001 });
    this.address = normalizeEvmAddress(accounts[0]);
    this.chainId = Number(await this.request('eth_chainId'));
    return { address: this.address, chainId: this.chainId };
  }

  /**
   * Move the wallet onto Robinhood Chain, adding the network when the wallet
   * has never seen it. Resolves only after the wallet reports the new chain.
   */
  async ensureChain({ timeoutMs = 30_000 } = {}) {
    if (this.onCorrectChain()) return true;
    const target = hexChainId(this.network.chainId);
    const confirmed = new Promise((resolveChain) => {
      const stop = this.onChange((event) => {
        if (event.type === 'chainChanged' && event.correct) { stop(); resolveChain(true); }
      });
      setTimeout(() => { stop(); resolveChain(false); }, timeoutMs);
    });
    try {
      await this.request('wallet_switchEthereumChain', [{ chainId: target }]);
    } catch (error) {
      if (classifyWalletError(error) !== WALLET_ERRORS.CHAIN_UNKNOWN) throw error;
      await this.request('wallet_addEthereumChain', [walletNetworkMetadata(this.network.networkType)]);
      await this.request('wallet_switchEthereumChain', [{ chainId: target }]).catch(() => {});
    }
    // Some wallets resolve the switch before emitting chainChanged.
    this.chainId = Number(await this.request('eth_chainId'));
    if (this.onCorrectChain()) return true;
    return confirmed;
  }

  async signMessage(message) {
    return this.request('personal_sign', [toHexUtf8(message), this.address]);
  }

  /** Guard every write: a transaction must never leave on the wrong chain. */
  async #assertReady() {
    if (!this.address) throw new Error('Connect a wallet first.');
    this.chainId = Number(await this.request('eth_chainId'));
    if (!this.onCorrectChain()) {
      throw Object.assign(new Error(`Switch to ${this.network.networkName} (chain id ${this.network.chainId}) before signing.`), { code: 4901 });
    }
  }

  async sendTransaction({ to, data, value = '0x0' }) {
    await this.#assertReady();
    return this.request('eth_sendTransaction', [{
      from: this.address,
      to: normalizeEvmAddress(to),
      data,
      value,
    }]);
  }

  approve({ tokenAddress, spender, rawAmount }) {
    return this.sendTransaction({
      to: tokenAddress,
      data: encodeFunctionData({
        abi: ERC20_ABI, functionName: 'approve', args: [normalizeEvmAddress(spender), toBigInt(rawAmount)],
      }),
    });
  }

  deposit({ depositContractAddress, tokenAddress, rawAmount, depositIdHash }) {
    return this.sendTransaction({
      to: depositContractAddress,
      data: encodeFunctionData({
        abi: DEPOSIT_VAULT_ABI,
        functionName: 'deposit',
        args: [normalizeEvmAddress(tokenAddress), toBigInt(rawAmount), depositIdHash],
      }),
    });
  }

  /** Poll for a receipt through the wallet's own provider. */
  async waitForReceipt(hash, { timeoutMs = 180_000, intervalMs = 2500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const receipt = await this.request('eth_getTransactionReceipt', [hash]).catch(() => null);
      if (receipt) return receipt;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }
}

function toHexUtf8(text) {
  const bytes = new TextEncoder().encode(String(text));
  let out = '0x';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/**
 * Connect one of the discovered wallets. `walletId` 'walletconnect' opens the
 * WalletConnect flow when this deployment configured a project id.
 */
export async function connectEvmWallet({ walletId, network, walletConnectProjectId, metadata }) {
  let provider = null;
  let providerType = walletId;
  if (walletId === 'walletconnect') {
    provider = await connectWalletConnect({
      projectId: walletConnectProjectId,
      chain: network,
      metadata: metadata || {
        name: 'Token City',
        description: 'Token City on Robinhood Chain',
        url: location.origin,
        icons: [`${location.origin}/favicon.ico`],
      },
    });
  } else {
    const wallet = discoverEvmWallets().find((entry) => entry.id === walletId);
    if (!wallet) throw new Error('That wallet is not available in this browser.');
    if (!wallet.provider) {
      const error = new Error(`${wallet.name} is not installed in this browser.`);
      error.installUrl = wallet.url;
      throw error;
    }
    provider = wallet.provider;
    providerType = wallet.id;
  }
  const session = new EvmWalletSession({ provider, providerType, network });
  await session.connect();
  return session;
}

export function formatBalance(rawAmount, decimals, { maximumFractionDigits = 4 } = {}) {
  const exact = formatUnits(toBigInt(rawAmount), Number(decimals));
  const [whole, fraction = ''] = exact.split('.');
  const grouped = Number(whole).toLocaleString('en-US');
  const shown = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return shown ? `${grouped}.${shown}` : grouped;
}
