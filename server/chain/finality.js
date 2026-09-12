// Robinhood Chain settlement policy (task8 §11.6, §13.4).
//
// Robinhood Chain is an Arbitrum L2: the sequencer confirms quickly, the batch
// is later posted to Ethereum and finalized there. Elapsed time is never proof
// of settlement — the chain's own safe/finalized tags are.

// QUOTED precedes SUBMITTED: the server has issued a deposit id and priced the
// conversion, but no wallet transaction exists yet. Everything from SUBMITTED
// onwards is the settlement model required by §11.6.
export const DEPOSIT_STATES = Object.freeze([
  'QUOTED', 'SUBMITTED', 'SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'CREDITED', 'REORGED', 'FAILED', 'EXPIRED',
]);

export const WITHDRAWAL_STATES = Object.freeze([
  'REQUESTED', 'VALIDATED', 'QUEUED', 'SUBMITTED', 'SOFT_CONFIRMED', 'SAFE',
  'FINALIZED', 'COMPLETED', 'FAILED', 'REVERSED', 'MANUAL_REVIEW',
]);

export const FINALITY_LEVELS = Object.freeze({ latest: 1, safe: 2, finalized: 3 });

const DEPOSIT_TRANSITIONS = Object.freeze({
  QUOTED: ['SUBMITTED', 'EXPIRED', 'FAILED'],
  SUBMITTED: ['SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'FAILED', 'REORGED', 'EXPIRED'],
  SOFT_CONFIRMED: ['SAFE', 'FINALIZED', 'CREDITED', 'FAILED', 'REORGED'],
  SAFE: ['FINALIZED', 'CREDITED', 'REORGED', 'FAILED'],
  FINALIZED: ['CREDITED', 'REORGED'],
  CREDITED: [],
  REORGED: ['SUBMITTED', 'SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'FAILED'],
  FAILED: [],
  EXPIRED: [],
});

const WITHDRAWAL_TRANSITIONS = Object.freeze({
  REQUESTED: ['VALIDATED', 'FAILED', 'REVERSED'],
  VALIDATED: ['QUEUED', 'FAILED', 'REVERSED'],
  QUEUED: ['SUBMITTED', 'FAILED', 'REVERSED', 'MANUAL_REVIEW'],
  SUBMITTED: ['SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'FAILED', 'MANUAL_REVIEW'],
  SOFT_CONFIRMED: ['SAFE', 'FINALIZED', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW'],
  SAFE: ['FINALIZED', 'COMPLETED', 'MANUAL_REVIEW'],
  FINALIZED: ['COMPLETED', 'MANUAL_REVIEW'],
  COMPLETED: [],
  FAILED: ['REVERSED', 'MANUAL_REVIEW'],
  REVERSED: [],
  MANUAL_REVIEW: ['COMPLETED', 'FAILED', 'REVERSED'],
});

export function canTransitionDeposit(from, to) {
  return Boolean(DEPOSIT_TRANSITIONS[from]?.includes(to));
}

export function canTransitionWithdrawal(from, to) {
  return Boolean(WITHDRAWAL_TRANSITIONS[from]?.includes(to));
}

export function assertDepositTransition(from, to) {
  if (from === to) return to;
  if (!canTransitionDeposit(from, to)) throw new Error(`Deposit cannot move from ${from} to ${to}`);
  return to;
}

export function assertWithdrawalTransition(from, to) {
  if (from === to) return to;
  if (!canTransitionWithdrawal(from, to)) throw new Error(`Withdrawal cannot move from ${from} to ${to}`);
  return to;
}

/**
 * Settlement requirement by value. `CREDIT_POLICY` is data, not a timeout: a
 * deposit is only creditable once the chain itself reports the transaction's
 * block at or beyond the required tag.
 */
export const CREDIT_POLICY = Object.freeze({
  testnet: Object.freeze([
    { maxRawValueMultiplier: null, requiredTag: 'safe' },
  ]),
  mainnet: Object.freeze([
    // Small production credits settle at the L2 safe tag; larger ones wait for
    // Ethereum finality so a batch reorg can never mint Game Coins.
    { maxRawValueMultiplier: 1000, requiredTag: 'safe' },
    { maxRawValueMultiplier: null, requiredTag: 'finalized' },
  ]),
});

/**
 * Required finality tag for one deposit.
 * `rawAmount` and `oneTokenUnit` are BigInt raw units, so the comparison never
 * goes through a JavaScript float.
 */
export function requiredFinalityTag({ networkType, rawAmount, tokenDecimals, policy = CREDIT_POLICY }) {
  const table = policy[networkType] || policy.mainnet;
  const oneToken = 10n ** BigInt(tokenDecimals);
  const amount = BigInt(rawAmount);
  for (const rule of table) {
    if (rule.maxRawValueMultiplier === null) return rule.requiredTag;
    if (amount <= oneToken * BigInt(rule.maxRawValueMultiplier)) return rule.requiredTag;
  }
  return 'finalized';
}

/**
 * Map an observed block against the chain's safe/finalized heads to a deposit
 * finality status. `observed` carries the block the receipt was mined in.
 */
export function finalityStatusFor({ blockNumber, safeBlockNumber, finalizedBlockNumber }) {
  const block = BigInt(blockNumber);
  if (finalizedBlockNumber !== null && finalizedBlockNumber !== undefined
    && block <= BigInt(finalizedBlockNumber)) return 'FINALIZED';
  if (safeBlockNumber !== null && safeBlockNumber !== undefined
    && block <= BigInt(safeBlockNumber)) return 'SAFE';
  return 'SOFT_CONFIRMED';
}

export function meetsRequirement(status, requiredTag) {
  const reached = { SOFT_CONFIRMED: FINALITY_LEVELS.latest, SAFE: FINALITY_LEVELS.safe, FINALIZED: FINALITY_LEVELS.finalized }[status] || 0;
  const required = FINALITY_LEVELS[requiredTag] || FINALITY_LEVELS.finalized;
  return reached >= required;
}

/** Stable identity of one processed chain log (task8 §11.5). */
export function logIdentity({ chainId, transactionHash, logIndex }) {
  if (!Number.isInteger(Number(chainId))) throw new Error('Chain id is required for a log identity');
  const hash = String(transactionHash || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new Error('Transaction hash is required for a log identity');
  const index = Number(logIndex);
  if (!Number.isInteger(index) || index < 0) throw new Error('Log index is required for a log identity');
  return `${Number(chainId)}:${hash}:${index}`;
}
