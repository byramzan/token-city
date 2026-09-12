// Deposit and withdrawal quotes (task8 §7.6, §11.2, §13.1).

import { normalizeEvmAddress, toRawAmount, fromRawAmount, toBigInt, keccakHex } from './evm.js';
import { networkByType } from './networks.js';

export const DEPOSIT_QUOTE_TTL_MS = 10 * 60_000;
export const WITHDRAWAL_QUOTE_TTL_MS = 5 * 60_000;

/**
 * The on-chain depositId is the keccak hash of the opaque server id. The raw id
 * never leaves the backend in a guessable form, and the hash is what the
 * deposit contract stores and emits.
 */
export function depositIdHash(depositId) {
  return keccakHex(String(depositId));
}

export function createDepositQuote({
  depositId, gameAccountId, walletId, walletAddress, config, displayTokenAmount,
  expectedGameCoins, conversionRuleVersion, now = Date.now(), ttlMs = DEPOSIT_QUOTE_TTL_MS,
}) {
  const network = networkByType(config.environment);
  const rawTokenAmount = toRawAmount(displayTokenAmount, config.decimals);
  return {
    depositId: String(depositId),
    depositIdHash: depositIdHash(depositId),
    gameAccountId: String(gameAccountId),
    walletId: String(walletId),
    walletAddress: normalizeEvmAddress(walletAddress, { label: 'Wallet address' }),
    chainId: network.chainId,
    networkType: network.networkType,
    tokenConfigId: config.tokenConfigId,
    tokenConfigVersion: config.configVersion,
    tokenAddress: config.contractAddress,
    depositContractAddress: config.depositContractAddress,
    vaultAddress: config.vaultAddress,
    tokenDecimals: config.decimals,
    rawTokenAmount: rawTokenAmount.toString(),
    displayTokenAmount: fromRawAmount(rawTokenAmount, config.decimals),
    expectedGameCoins: Math.trunc(Number(expectedGameCoins)),
    conversionRuleVersion: String(conversionRuleVersion),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

export function createWithdrawalQuote({
  withdrawalId, gameAccountId, walletId, walletAddress, config, gameCoinAmount,
  displayTokenAmount, conversionRuleVersion, idempotencyKey,
  now = Date.now(), ttlMs = WITHDRAWAL_QUOTE_TTL_MS,
}) {
  const network = networkByType(config.environment);
  const rawTokenAmount = toRawAmount(displayTokenAmount, config.decimals);
  return {
    withdrawalId: String(withdrawalId),
    gameAccountId: String(gameAccountId),
    walletId: String(walletId),
    walletAddress: normalizeEvmAddress(walletAddress, { label: 'Destination wallet' }),
    chainId: network.chainId,
    networkType: network.networkType,
    tokenConfigId: config.tokenConfigId,
    tokenConfigVersion: config.configVersion,
    tokenAddress: config.contractAddress,
    vaultAddress: config.vaultAddress,
    tokenDecimals: config.decimals,
    rawTokenAmount: rawTokenAmount.toString(),
    displayTokenAmount: fromRawAmount(rawTokenAmount, config.decimals),
    gameCoinAmount: Math.trunc(Number(gameCoinAmount)),
    conversionRuleVersion: String(conversionRuleVersion),
    idempotencyKey: String(idempotencyKey),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
}

/** Exact approval amount for one deposit (§11.3): never unlimited by default. */
export function approvalPlan({ quote, currentAllowance }) {
  const required = toBigInt(quote.rawTokenAmount);
  const allowance = toBigInt(currentAllowance ?? 0);
  if (allowance >= required) return { required: required.toString(), needsApproval: false, approveAmount: '0' };
  // Some ERC-20 implementations refuse a non-zero -> non-zero allowance change.
  // Resetting to zero first is the portable sequence.
  return {
    required: required.toString(),
    needsApproval: true,
    approveAmount: required.toString(),
    resetToZeroFirst: allowance > 0n,
  };
}
