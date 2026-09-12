// Versioned Game Coin conversion rule (fixed rate).
//
// Fixed exchange rate: 100 project tokens == 1 Game Coin, both directions.
//   deposit:    tokens = coins * 100      (100 tokens buy 1 coin)
//   withdrawal: tokens = coins * 100      (1 coin returns 100 tokens)
//   credit:     coins  = floor(tokens / 100)  (leftover tokens < 100 carry no coin)
//
// There is no bonding curve, no price impact and no fee. The rate is constant,
// so quotes never drift and there is nothing to deviate from. Every quote still
// records CONVERSION_RULE_VERSION so a future rate change is auditable per
// deposit and per withdrawal.

export const CONVERSION_RULE_VERSION = 'tcity-fixed-100to1-v1';

// Project tokens per one Game Coin. Whole-token unit (not raw on-chain units).
export const TOKENS_PER_COIN = 100;

export const CONVERSION_DEFAULTS = Object.freeze({
  tokensPerCoin: TOKENS_PER_COIN,
  feePct: 0,
});

/** Fixed reference price kept for compatibility with older callers/UI. */
export function spotPrice() {
  return 1 / TOKENS_PER_COIN;
}

/** Fixed rate: the smoothed price equals the spot price. */
export function twapPrice() {
  return 1 / TOKENS_PER_COIN;
}

/** No size-based impact under a fixed rate. */
export function impactPctFor() {
  return 0;
}

/** Project tokens required to fund `coins` Game Coins. */
export function fundingTokensFor(coins, { tokensPerCoin = TOKENS_PER_COIN } = {}) {
  const amount = Math.trunc(Number(coins));
  const tokens = amount * tokensPerCoin;
  return {
    price: 1 / tokensPerCoin,
    spotAtQuote: 1 / tokensPerCoin,
    feePct: 0,
    impactPct: 0,
    tokens,
    conversionRuleVersion: CONVERSION_RULE_VERSION,
  };
}

/** Project tokens produced by withdrawing `coins` Game Coins. */
export function withdrawalTokensFor(coins, { tokensPerCoin = TOKENS_PER_COIN } = {}) {
  const amount = Math.trunc(Number(coins));
  const tokens = amount * tokensPerCoin;
  return {
    price: 1 / tokensPerCoin,
    spotAtQuote: 1 / tokensPerCoin,
    feePct: 0,
    tokens,
    conversionRuleVersion: CONVERSION_RULE_VERSION,
  };
}

/** Game Coins credited for a verified on-chain deposit of `tokens`.
 *  Leftover tokens below one whole coin (100) carry no coin. */
export function coinsForTokens(tokens, { tokensPerCoin = TOKENS_PER_COIN } = {}) {
  const coins = Math.floor(Number(tokens) / tokensPerCoin);
  return { coins, price: 1 / tokensPerCoin, conversionRuleVersion: CONVERSION_RULE_VERSION };
}

/** Fixed rate never drifts, so a quote is always within the allowed band. */
export function deviationWithinLimit() {
  return true;
}
