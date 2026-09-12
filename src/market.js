// Demo market engine (task4 §4, §8, §12–§13).
// The Project Token price follows a simulated bonding-curve/PumpSwap pool, so
// the token-per-coin rate changes over time. Game Coins keep a stable unit
// value; issuance always uses a protected quote (TWAP-ish smoothing, fee,
// price impact, expiry) and actual net settlement — never a client screenshot.

import { state, save, tokenMeta, activeWallet, dailyUsageOf } from './state.js';
import { issueCoins, startWithdrawal, finishWithdrawal, cancelWithdrawal, balance, acct } from './ledger.js';
// The pricing rule itself lives in a shared module so the browser preview and
// the authoritative server quote can never drift apart (task8 §12).
import {
  CONVERSION_RULE_VERSION, deviationWithinLimit, fundingTokensFor, spotPrice, twapPrice, withdrawalTokensFor,
} from '../server/conversion.js';

export { spotPrice, twapPrice, CONVERSION_RULE_VERSION };

function cfg() { return state.tokenConfig; }

/** Quote: how many Project Tokens are needed to fund `coins` Game Coins. */
export function quoteFunding(coins) {
  const c = cfg();
  const priced = fundingTokensFor(coins, { feePct: c.feePct });
  return {
    id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: 'fund',
    coins,
    tokens: priced.tokens,
    price: priced.price,
    spotAtQuote: priced.spotAtQuote,
    feePct: priced.feePct,
    impactPct: priced.impactPct,
    slippagePct: c.maxSlippagePct,
    conversionRuleVersion: priced.conversionRuleVersion,
    expiresAt: Date.now() + c.quoteTtlMs,
  };
}

/** Quote: expected Project Token output for withdrawing `coins`. */
export function quoteWithdraw(coins) {
  const c = cfg();
  const priced = withdrawalTokensFor(coins, { feePct: c.feePct });
  return {
    id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    kind: 'withdraw',
    coins,
    tokens: priced.tokens,
    price: priced.price,
    spotAtQuote: priced.spotAtQuote,
    feePct: priced.feePct,
    conversionRuleVersion: priced.conversionRuleVersion,
    expiresAt: Date.now() + c.quoteTtlMs,
  };
}

/** Deviation guard: spot vs quote price (stale/manipulated price rejection). */
function deviationOk(quote) {
  // Compare like-for-like spot values. Comparing live spot to a lagging TWAP
  // rejected otherwise valid quotes immediately during ordinary price waves.
  return deviationWithinLimit(quote, { maxDeviationPct: cfg().maxDeviationPct });
}

/**
 * Execute a funding transaction against a linked wallet.
 * Steps mirror §12.1: expiry → wallet balance → signed tx (demo) → confirmed
 * settlement → ledger issuance keyed by tx signature (idempotent).
 */
export async function executeFunding(quote, wallet, { deposit } = {}) {
  if (!state.account) return { error: 'Connect a wallet first' };
  if (!wallet?.address) return { error: 'Select a wallet' };
  if (!quote || quote.kind !== 'fund' || !Number.isFinite(quote.coins) || quote.coins <= 0) {
    return { error: 'Invalid funding quote' };
  }
  if (!cfg().flags.funding) return { error: 'Funding is disabled by configuration' };
  // The active token is the versioned server configuration; funding stays shut
  // until an operator has validated and activated one (task8 §7.4).
  if (wallet.provider !== 'demo' && cfg().chain?.token?.status !== 'ACTIVE') {
    return { error: 'No project token is active yet. Deposits open when the operator activates the token configuration.' };
  }
  if (Date.now() > quote.expiresAt) return { error: 'Quote expired — request a new one' };
  if (!deviationOk(quote)) return { error: 'Price moved too far from the quote — request a new one' };
  const accountUsage = dailyUsageOf(state.account.id);
  const walletUsage = dailyUsageOf(`wallet:${wallet.address}`);
  if (accountUsage.funded + quote.coins > cfg().dailyFundLimit) return { error: 'Daily account funding limit exceeded' };
  if (walletUsage.funded + quote.coins > cfg().dailyFundLimit) return { error: 'Daily wallet funding limit exceeded' };
  const isDemo = wallet.provider === 'demo';
  const meta = tokenMeta(wallet.address);
  if (isDemo && meta.tokenBalance < quote.tokens) return { error: 'Not enough tokens in this wallet' };
  let settlement;
  try {
    settlement = isDemo
      ? { signature: 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9) }
      : await deposit?.({ quote, wallet });
  } catch (error) {
    return { error: error?.message || 'Project Token deposit failed' };
  }
  if (!settlement?.signature) return { error: 'This wallet is not ready for an on-chain deposit' };
  const signature = settlement.signature;
  if (isDemo) meta.tokenBalance -= quote.tokens;
  const res = issueCoins(state.account.id, quote.coins, {  // ledger side
    signature, reason: 'deposit', reserveValue: quote.coins,
  });
  if (res.duplicate) return { error: 'Duplicate transaction signature' };
  state.account.converted += quote.tokens;
  accountUsage.funded += quote.coins;
  walletUsage.funded += quote.coins;
  save();
  return { signature, explorer: settlement.explorer || null, coins: quote.coins, tokens: quote.tokens };
}

/** Execute a withdrawal to the verified withdrawal wallet (§13). */
export async function executeWithdraw(quote, { payout } = {}) {
  const c = cfg();
  if (!c.flags.withdrawal) return { error: 'Withdrawals are disabled by configuration' };
  if (Date.now() > quote.expiresAt) return { error: 'Quote expired — request a new one' };
  if (quote.coins < c.minWithdraw) return { error: `Minimum withdrawal is ${c.minWithdraw} coins` };
  const owner = state.account.id;
  const wallet = activeWallet('withdrawalWallet');
  if (!wallet) return { error: 'No verified withdrawal wallet' };
  const accountUsage = dailyUsageOf(owner);
  const walletUsage = dailyUsageOf(`wallet:${wallet.address}`);
  if (accountUsage.withdrawn + quote.coins > c.dailyWithdrawLimit) return { error: 'Daily account withdrawal limit exceeded' };
  if (walletUsage.withdrawn + quote.coins > c.dailyWithdrawLimit) return { error: 'Daily wallet withdrawal limit exceeded' };
  if (!deviationOk(quote)) return { error: 'Price moved too far from the quote — request a new one' };
  const lock = startWithdrawal(owner, quote.coins, 'wl_' + quote.id);
  if (!lock) return { error: 'Not enough available coins' };
  const isDemo = wallet.provider === 'demo';
  let settlement;
  try {
    settlement = isDemo
      ? { signature: 'wx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9) }
      : await payout?.({ quote, wallet, accountId: owner });
  } catch (error) {
    cancelWithdrawal(owner, quote.coins);
    return { error: `${error?.message || 'Network transfer failed'} — coins returned to your balance` };
  }
  if (!settlement?.signature) {
    cancelWithdrawal(owner, quote.coins);
    return { error: 'Treasury payout is not configured — coins returned to your balance' };
  }
  const signature = settlement.signature;
  finishWithdrawal(owner, quote.coins, { signature });
  if (isDemo) tokenMeta(wallet.address).tokenBalance += quote.tokens;
  accountUsage.withdrawn += quote.coins;
  walletUsage.withdrawn += quote.coins;
  save();
  return { signature, explorer: settlement.explorer || null, tokens: quote.tokens, wallet };
}

export function availableCoins() {
  return state.account ? balance(acct(state.account.id, 'available')) : 0;
}
