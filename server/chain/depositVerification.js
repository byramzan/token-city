// Independent server-side deposit verification (task8 §11.5).
//
// A client-supplied transaction hash is only a hint about where to look. Every
// decision below is made from data the backend read from the chain itself.

import { sameAddress, toBigInt } from './evm.js';
import { logIdentity, finalityStatusFor, meetsRequirement, requiredFinalityTag } from './finality.js';

export const DEPOSIT_REJECTIONS = Object.freeze({
  WRONG_CHAIN: 'wrong-chain',
  NO_RECEIPT: 'receipt-unavailable',
  RECEIPT_FAILED: 'transaction-reverted',
  WRONG_CONTRACT: 'wrong-deposit-contract',
  NO_EVENT: 'deposit-event-missing',
  WRONG_TOKEN: 'event-token-mismatch',
  WRONG_WALLET: 'event-wallet-mismatch',
  WRONG_DEPOSIT_ID: 'event-deposit-id-mismatch',
  AMOUNT_MISMATCH: 'event-amount-mismatch',
  QUOTE_EXPIRED: 'quote-expired-before-submission',
  ALREADY_CREDITED: 'already-credited',
  REORGED: 'block-no-longer-canonical',
});

/**
 * Decide what to do with an observed deposit transaction.
 *
 * All inputs are already-fetched chain facts:
 *   receipt          — eth_getTransactionReceipt result (or null)
 *   depositedEvents  — decoded `Deposited` logs from that receipt
 *   canonicalBlockHash — hash of `receipt.blockNumber` re-read from the chain
 *   heads            — { safeBlockNumber, finalizedBlockNumber }
 *   quote            — the server-issued deposit quote
 *   creditedLogIds   — identities already credited by this backend
 *
 * Returns { decision, status, finalityStatus, reason?, event?, logIdentity? }
 * where decision is one of: credit | wait | reject | reorg.
 */
export function evaluateDeposit({
  quote,
  receipt,
  depositedEvents = [],
  canonicalBlockHash = null,
  heads = {},
  creditedLogIds = new Set(),
  networkType,
  submittedAt = null,
}) {
  const fail = (reason, status = 'FAILED') => ({ decision: 'reject', status, reason });

  if (!receipt) return { decision: 'wait', status: 'SUBMITTED', reason: DEPOSIT_REJECTIONS.NO_RECEIPT };
  if (Number(receipt.chainId ?? quote.chainId) !== Number(quote.chainId)) return fail(DEPOSIT_REJECTIONS.WRONG_CHAIN);
  if (receipt.status !== 'success' && receipt.status !== 1 && receipt.status !== '0x1') {
    return fail(DEPOSIT_REJECTIONS.RECEIPT_FAILED);
  }
  if (!sameAddress(receipt.to, quote.depositContractAddress)) return fail(DEPOSIT_REJECTIONS.WRONG_CONTRACT);

  // One transaction may carry several logs. Only the log whose depositId equals
  // the server-issued id can settle this quote.
  const candidates = depositedEvents.filter((event) => !event.removed
    && sameAddress(event.address, quote.depositContractAddress));
  const event = candidates.find((entry) => String(entry.depositId).toLowerCase() === String(quote.depositIdHash).toLowerCase());
  if (!event) {
    return candidates.length
      ? fail(DEPOSIT_REJECTIONS.WRONG_DEPOSIT_ID)
      : fail(DEPOSIT_REJECTIONS.NO_EVENT);
  }
  if (!sameAddress(event.token, quote.tokenAddress)) return fail(DEPOSIT_REJECTIONS.WRONG_TOKEN);
  if (!sameAddress(event.wallet, quote.walletAddress)) return fail(DEPOSIT_REJECTIONS.WRONG_WALLET);
  if (toBigInt(event.amount) !== toBigInt(quote.rawTokenAmount)) return fail(DEPOSIT_REJECTIONS.AMOUNT_MISMATCH);

  const identity = logIdentity({
    chainId: quote.chainId,
    transactionHash: receipt.transactionHash,
    logIndex: event.logIndex,
  });
  if (creditedLogIds.has?.(identity) || (Array.isArray(creditedLogIds) && creditedLogIds.includes(identity))) {
    return { decision: 'reject', status: 'CREDITED', reason: DEPOSIT_REJECTIONS.ALREADY_CREDITED, logIdentity: identity, event };
  }

  // A quote must have still been valid when the user signed. `submittedAt`
  // comes from the block timestamp, not from the client's clock.
  if (submittedAt !== null && Number(submittedAt) > Number(quote.expiresAt)) {
    return fail(DEPOSIT_REJECTIONS.QUOTE_EXPIRED, 'EXPIRED');
  }

  if (canonicalBlockHash && String(canonicalBlockHash).toLowerCase() !== String(receipt.blockHash).toLowerCase()) {
    return {
      decision: 'reorg',
      status: 'REORGED',
      reason: DEPOSIT_REJECTIONS.REORGED,
      observedBlockHash: receipt.blockHash,
      canonicalBlockHash,
      logIdentity: identity,
      event,
    };
  }

  const finalityStatus = finalityStatusFor({
    blockNumber: receipt.blockNumber,
    safeBlockNumber: heads.safeBlockNumber ?? null,
    finalizedBlockNumber: heads.finalizedBlockNumber ?? null,
  });
  const requiredTag = requiredFinalityTag({
    networkType,
    rawAmount: toBigInt(quote.rawTokenAmount),
    tokenDecimals: quote.tokenDecimals,
  });
  if (!meetsRequirement(finalityStatus, requiredTag)) {
    return { decision: 'wait', status: finalityStatus, finalityStatus, requiredTag, logIdentity: identity, event };
  }
  return { decision: 'credit', status: finalityStatus, finalityStatus, requiredTag, logIdentity: identity, event };
}
