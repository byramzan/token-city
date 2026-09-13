import { walletBrandIcon } from '../walletIcons.js';
// Client-side Robinhood Chain service (task8 §8, §9.6, §10, §11, §13, §16).
//
// Nothing here decides anything financial. The browser prepares wallet
// requests, submits them and displays state; every value that matters — the
// token configuration, the quote, the credited amount, the finality status —
// comes back from the backend, which read it from the chain itself.

import { api } from '../../convex/_generated/api.js';
import { networkByChainId } from '../../server/chain/networks.js';
import { toBigInt } from '../../server/chain/evm.js';
import { connectEvmWallet, discoverEvmWallets, formatBalance, startProviderDiscovery, walletErrorMessage } from './evmWallet.js';

const SESSION_KEY = 'tokencity_chain_session_v1';

export const DEPOSIT_UI_STATES = Object.freeze({
  PREPARING: 'Preparing',
  APPROVAL_REQUIRED: 'Approval required',
  WAITING_APPROVAL_SIGNATURE: 'Waiting for approval signature',
  APPROVAL_SUBMITTED: 'Approval submitted',
  WAITING_DEPOSIT_SIGNATURE: 'Waiting for deposit signature',
  DEPOSIT_SUBMITTED: 'Deposit submitted',
  CONFIRMING: 'Confirming on Robinhood Chain',
  CREDITED: 'Credited',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
});

function readStoredSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function writeStoredSession(value) {
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private browsing: the session simply does not survive a reload */ }
}

export function createChainService({ getConvexClient, getAccountId, onEvent = () => {} }) {
  let publicConfig = null;
  let walletSession = null;
  let linked = readStoredSession();
  let unsubscribeDeposits = null;
  let unsubscribeWithdrawals = null;

  const convex = () => {
    const client = getConvexClient();
    if (!client) throw new Error('The game is not connected to its backend yet. Reconnecting…');
    return client;
  };

  /** Public configuration from the backend — never a hard-coded address. */
  async function loadConfig({ force = false } = {}) {
    if (publicConfig && !force) return publicConfig;
    const response = await fetch('/api/token-config', { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    publicConfig = {
      ...payload,
      network: payload.network || networkByChainId(46630),
    };
    onEvent({ type: 'token_config_refreshed', config: publicConfig });
    return publicConfig;
  }

  const network = () => publicConfig?.network || networkByChainId(46630);
  const token = () => publicConfig?.token || null;

  function requireToken() {
    const active = token();
    if (!active) throw new Error('No project token is active yet. The operator configures it on the protected operations page.');
    return active;
  }

  // ── wallet connection and ownership proof ─────────────────────────────────
  function availableWallets() {
    startProviderDiscovery();
    const wallets = discoverEvmWallets();
    if (publicConfig?.walletConnectProjectId) {
      wallets.push({
        id: 'walletconnect', name: 'WalletConnect', color: '#3b99fc',
        icon: walletBrandIcon('walletconnect'),
        installed: true, source: 'walletconnect', url: '',
      });
    }
    return wallets;
  }

  async function connect(walletId) {
    await loadConfig();
    walletSession?.destroy();
    walletSession = await connectEvmWallet({
      walletId,
      network: network(),
      walletConnectProjectId: publicConfig?.walletConnectProjectId,
    });
    walletSession.onChange((event) => {
      // A changed account invalidates every pending financial screen (§9.5).
      if (event.type === 'accountsChanged' || event.type === 'disconnected') {
        linked = null;
        writeStoredSession(null);
      }
      onEvent({ type: 'wallet_network_changed', change: event });
    });
    const switched = await walletSession.ensureChain();
    if (!switched) {
      throw new Error(`Approve the switch to ${network().networkName} in your wallet, then try again.`);
    }
    return { address: walletSession.address, chainId: walletSession.chainId, providerType: walletSession.providerType };
  }

  /** One-time signed challenge. The wallet proves ownership; nothing moves. */
  async function signIn() {
    if (!walletSession?.address) throw new Error('Connect a wallet first.');
    const accountId = getAccountId();
    if (!accountId) throw new Error('Create or select a game account first.');
    const challenge = await convex().action(api.chainActions.issueWalletChallenge, {
      accountId,
      walletAddress: walletSession.address,
      chainId: walletSession.chainId,
      domain: location.host,
      uri: location.origin,
    });
    const signature = await walletSession.signMessage(challenge.message);
    const result = await convex().action(api.chainActions.verifyWalletChallenge, {
      accountId,
      walletAddress: walletSession.address,
      nonce: challenge.nonce,
      signature,
      providerType: walletSession.providerType,
      domain: location.host,
    });
    linked = {
      accountId,
      sessionToken: result.sessionToken,
      walletId: result.walletId,
      address: result.address,
      chainId: result.chainId,
      expiresAt: result.expiresAt,
    };
    writeStoredSession(linked);
    subscribe();
    onEvent({ type: 'wallet_linked', wallet: { walletId: result.walletId, address: result.address } });
    return linked;
  }

  function currentLink() {
    if (!linked) return null;
    if (linked.expiresAt && linked.expiresAt <= Date.now()) { linked = null; writeStoredSession(null); return null; }
    if (getAccountId() && linked.accountId !== getAccountId()) return null;
    return linked;
  }

  async function signOut() {
    const link = currentLink();
    if (link) {
      await convex().mutation(api.chain.endSession, {
        accountId: link.accountId, sessionToken: link.sessionToken,
      }).catch(() => {});
    }
    linked = null;
    writeStoredSession(null);
    unsubscribeDeposits?.(); unsubscribeDeposits = null;
    unsubscribeWithdrawals?.(); unsubscribeWithdrawals = null;
  }

  // ── balances (§10) ────────────────────────────────────────────────────────
  async function balances(address = walletSession?.address) {
    if (!address) return null;
    await loadConfig();
    const result = await convex().action(api.chainActions.walletBalances, { walletAddress: address });
    return {
      ...result,
      tokenDisplay: result.token ? formatBalance(result.token.rawAmount, result.token.decimals) : null,
      nativeDisplay: formatBalance(result.native.rawAmount, 18),
      // A wallet holding the token but no ETH cannot approve or deposit (§10).
      gasWarning: toBigInt(result.native.rawAmount) === 0n
        ? 'This wallet has no ETH on Robinhood Chain. Add ETH for gas before approving or depositing.'
        : null,
    };
  }

  // ── deposits (§11) ────────────────────────────────────────────────────────
  async function quoteDeposit(coins) {
    const link = currentLink();
    if (!link) throw new Error('Sign in with your wallet first.');
    requireToken();
    return convex().action(api.chainActions.quoteDeposit, {
      accountId: link.accountId, sessionToken: link.sessionToken, walletId: link.walletId, coins,
    });
  }

  /**
   * Run one deposit. `onState` receives the §11.4 UI states in order; the
   * caller only ever displays them, it never decides that a deposit succeeded.
   */
  async function runDeposit({ quote, approval, onState = () => {} }) {
    const link = currentLink();
    if (!link) throw new Error('Sign in with your wallet first.');
    if (!walletSession?.address) throw new Error('Reconnect your wallet before depositing.');
    if (Date.now() > quote.expiresAt) throw new Error('This quote expired. Request a new one.');
    onState(DEPOSIT_UI_STATES.PREPARING);
    if (!await walletSession.ensureChain()) throw new Error(`Switch to ${network().networkName} before depositing.`);

    if (approval?.needsApproval) {
      onState(DEPOSIT_UI_STATES.APPROVAL_REQUIRED);
      // An approval for exactly the required amount, with the spender shown.
      if (approval.resetToZeroFirst) {
        onState(DEPOSIT_UI_STATES.WAITING_APPROVAL_SIGNATURE);
        const resetHash = await walletSession.approve({
          tokenAddress: quote.tokenAddress, spender: quote.depositContractAddress, rawAmount: '0',
        });
        await walletSession.waitForReceipt(resetHash);
      }
      onState(DEPOSIT_UI_STATES.WAITING_APPROVAL_SIGNATURE);
      const approvalHash = await walletSession.approve({
        tokenAddress: quote.tokenAddress,
        spender: quote.depositContractAddress,
        rawAmount: approval.approveAmount,
      });
      onState(DEPOSIT_UI_STATES.APPROVAL_SUBMITTED);
      const receipt = await walletSession.waitForReceipt(approvalHash);
      if (!receipt || receipt.status === '0x0') throw new Error('The approval transaction failed. Nothing was deposited.');
    }

    onState(DEPOSIT_UI_STATES.WAITING_DEPOSIT_SIGNATURE);
    const depositHash = await walletSession.deposit({
      depositContractAddress: quote.depositContractAddress,
      tokenAddress: quote.tokenAddress,
      rawAmount: quote.rawTokenAmount,
      depositIdHash: quote.depositIdHash,
    });
    onState(DEPOSIT_UI_STATES.DEPOSIT_SUBMITTED);

    let result = await convex().action(api.chainActions.submitDeposit, {
      accountId: link.accountId,
      sessionToken: link.sessionToken,
      depositId: quote.depositId,
      transactionHash: depositHash,
    });
    onState(DEPOSIT_UI_STATES.CONFIRMING, result);
    // The backend decides when the deposit is settled; the client only waits.
    const deadline = Date.now() + 10 * 60_000;
    while (result.status !== 'CREDITED' && Date.now() < deadline) {
      if (['FAILED', 'EXPIRED', 'REORGED'].includes(result.status)) break;
      await new Promise((r) => setTimeout(r, 4000));
      result = await convex().action(api.chainActions.refreshDeposit, {
        accountId: link.accountId, sessionToken: link.sessionToken, depositId: quote.depositId,
      });
      onState(DEPOSIT_UI_STATES.CONFIRMING, result);
    }
    if (result.status === 'CREDITED') {
      onState(DEPOSIT_UI_STATES.CREDITED, result);
      return { ...result, transactionHash: depositHash, credited: true };
    }
    onState(result.status === 'EXPIRED' ? DEPOSIT_UI_STATES.EXPIRED : DEPOSIT_UI_STATES.FAILED, result);
    return { ...result, transactionHash: depositHash, credited: false };
  }

  // ── withdrawals (§13) ─────────────────────────────────────────────────────
  async function requestWithdrawal({ coins, idempotencyKey }) {
    const link = currentLink();
    if (!link) throw new Error('Sign in with your wallet first.');
    requireToken();
    return convex().action(api.chainActions.requestWithdrawal, {
      accountId: link.accountId,
      sessionToken: link.sessionToken,
      walletId: link.walletId,
      coins,
      idempotencyKey,
    });
  }

  // ── private real-time state (§16.4) ───────────────────────────────────────
  function subscribe() {
    const link = currentLink();
    const client = getConvexClient();
    if (!link || !client) return;
    unsubscribeDeposits?.();
    unsubscribeWithdrawals?.();
    const args = { accountId: link.accountId, sessionToken: link.sessionToken };
    unsubscribeDeposits = client.onUpdate(api.chain.myDeposits, args, (rows) => {
      onEvent({ type: 'deposit_status_changed', deposits: rows });
    }, () => {});
    unsubscribeWithdrawals = client.onUpdate(api.chain.myWithdrawals, args, (rows) => {
      onEvent({ type: 'withdrawal_status_changed', withdrawals: rows });
    }, () => {});
  }

  function explorerTx(hash) {
    return `${network().explorerBaseUrl}/tx/${hash}`;
  }

  function explorerAddress(address) {
    return `${network().explorerBaseUrl}/address/${address}`;
  }

  return {
    loadConfig,
    config: () => publicConfig,
    network,
    token,
    availableWallets,
    connect,
    signIn,
    signOut,
    currentLink,
    walletAddress: () => walletSession?.address || currentLink()?.address || null,
    /** Plain personal_sign for non-financial capability proofs. */
    signMessage: (message) => {
      if (!walletSession?.address) throw new Error('Connect a wallet first.');
      return walletSession.signMessage(message);
    },
    isOnCorrectChain: () => Boolean(walletSession?.onCorrectChain()),
    ensureChain: () => walletSession?.ensureChain(),
    balances,
    quoteDeposit,
    runDeposit,
    requestWithdrawal,
    subscribe,
    explorerTx,
    explorerAddress,
    walletErrorMessage: (error) => walletErrorMessage(error, { networkName: network().networkName }),
    destroy() {
      unsubscribeDeposits?.();
      unsubscribeWithdrawals?.();
      walletSession?.destroy();
      walletSession = null;
    },
  };
}
