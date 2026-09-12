// Versioned Game Coin conversion rules (task8 §12).
//
// The formula is exactly the one the Solana build shipped: a smoothed
// bonding-curve price, the configured fee and a size-based impact. Migrating
// the chain must not change what a player receives for the same configured
// values, so this module is a straight extraction — not a new pricing model.
// Every quote records `CONVERSION_RULE_VERSION`, so a future change is
// auditable per deposit and per withdrawal.

export const CONVERSION_RULE_VERSION = 'tcity-bonding-v1';

export const CONVERSION_DEFAULTS = Object.freeze({
  basePrice: 0.02,     // reserve units per project token at session start
  coinUnit: 1,         // reserve units per Game Coin (stable unit of account)
  feePct: 1.25,
  maxImpactPct: 8,
  impactDivisor: 40000,
  maxDeviationPct: 6,
});

export function spotPrice(now = Date.now(), { basePrice = CONVERSION_DEFAULTS.basePrice } = {}) {
  const t = now / 1000;
  const slow = Math.sin(t / 210) * 0.22 + Math.sin(t / 47) * 0.08;
  const fast = Math.sin(t / 9.7) * 0.035;
  return basePrice * (1 + slow + fast);
}

/** Smoothed protected price (TWAP stand-in). */
export function twapPrice(now = Date.now(), options = {}) {
  let sum = 0;
  const samples = 8;
  for (let i = 0; i < samples; i += 1) sum += spotPrice(now - i * 15000, options);
  return sum / samples;
}

export function impactPctFor(coins, { maxImpactPct = CONVERSION_DEFAULTS.maxImpactPct, impactDivisor = CONVERSION_DEFAULTS.impactDivisor } = {}) {
  return Math.min(maxImpactPct, (coins / impactDivisor) * 100);
}

/** Project tokens required to fund `coins` Game Coins. */
export function fundingTokensFor(coins, { feePct = CONVERSION_DEFAULTS.feePct, coinUnit = CONVERSION_DEFAULTS.coinUnit, now = Date.now(), ...options } = {}) {
  const price = twapPrice(now, options);
  const impactPct = impactPctFor(coins, options);
  const tokens = ((coins * coinUnit) / price) * (1 + (feePct + impactPct) / 100);
  return {
    price,
    spotAtQuote: spotPrice(now, options),
    feePct,
    impactPct: Math.round(impactPct * 100) / 100,
    tokens: Math.ceil(tokens),
    conversionRuleVersion: CONVERSION_RULE_VERSION,
  };
}

/** Project tokens produced by withdrawing `coins` Game Coins. */
export function withdrawalTokensFor(coins, { feePct = CONVERSION_DEFAULTS.feePct, coinUnit = CONVERSION_DEFAULTS.coinUnit, now = Date.now(), ...options } = {}) {
  const price = twapPrice(now, options);
  const tokens = ((coins * coinUnit) / price) * (1 - feePct / 100);
  return {
    price,
    spotAtQuote: spotPrice(now, options),
    feePct,
    tokens: Math.floor(tokens),
    conversionRuleVersion: CONVERSION_RULE_VERSION,
  };
}

/** Game Coins credited for a verified on-chain deposit of `tokens`. */
export function coinsForTokens(tokens, options = {}) {
  const { feePct = CONVERSION_DEFAULTS.feePct, coinUnit = CONVERSION_DEFAULTS.coinUnit, now = Date.now() } = options;
  const price = twapPrice(now, options);
  const coins = (tokens * price) / (coinUnit * (1 + feePct / 100));
  return { coins: Math.floor(coins), price, conversionRuleVersion: CONVERSION_RULE_VERSION };
}

/** Stale or manipulated price guard: live spot versus the quoted spot. */
export function deviationWithinLimit(quote, { maxDeviationPct = CONVERSION_DEFAULTS.maxDeviationPct, now = Date.now(), ...options } = {}) {
  const reference = quote.spotAtQuote || quote.price;
  if (!reference) return false;
  return Math.abs(spotPrice(now, options) - reference) / reference * 100 <= maxDeviationPct;
}
