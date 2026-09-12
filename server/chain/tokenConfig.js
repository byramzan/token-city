// Versioned token configuration rules (task8 §7.4, §7.6, §8).

import { normalizeEvmAddress, addressKey, sameAddress } from './evm.js';
import { networkByType, explorerTokenUrl, explorerAddressUrl } from './networks.js';

export const TOKEN_CONFIG_STATES = Object.freeze(['DRAFT', 'VALIDATED', 'ACTIVE', 'PAUSED', 'RETIRED']);

const TRANSITIONS = Object.freeze({
  DRAFT: ['VALIDATED', 'RETIRED'],
  VALIDATED: ['ACTIVE', 'DRAFT', 'RETIRED'],
  ACTIVE: ['PAUSED', 'RETIRED'],
  PAUSED: ['ACTIVE', 'RETIRED'],
  RETIRED: [],
});

export function canTransitionTokenConfig(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertTokenConfigTransition(from, to) {
  if (!canTransitionTokenConfig(from, to)) throw new Error(`Token configuration cannot move from ${from} to ${to}`);
  return to;
}

/** Token behaviour the first release deliberately does not support (§6.1). */
export const UNSUPPORTED_TOKEN_REASONS = Object.freeze({
  FEE_ON_TRANSFER: 'The contract delivered fewer tokens than were sent (fee-on-transfer or reflection).',
  REBASING: 'The reported balance changed between two reads without a transfer (rebasing token).',
  DECIMALS_OUT_OF_RANGE: 'Reported decimals are outside the supported 0–36 range.',
  NO_CODE: 'The address has no contract code on this chain.',
  METADATA_REVERT: 'A required ERC-20 metadata call reverted.',
  BALANCE_REVERT: 'balanceOf() did not return a value.',
});

/**
 * Validate what the administrator typed before any RPC call is made.
 * The chain id is derived from the chosen environment and is never free text.
 */
export function normalizeTokenConfigInput(input = {}) {
  const network = networkByType(input.environment);
  const expectedDecimals = input.expectedDecimals === '' || input.expectedDecimals === undefined || input.expectedDecimals === null
    ? null
    : Number(input.expectedDecimals);
  if (expectedDecimals !== null && (!Number.isInteger(expectedDecimals) || expectedDecimals < 0 || expectedDecimals > 36)) {
    throw new Error('Expected token decimals must be a whole number between 0 and 36');
  }
  const monitoringStartBlock = input.monitoringStartBlock === '' || input.monitoringStartBlock === undefined || input.monitoringStartBlock === null
    ? null
    : Number(input.monitoringStartBlock);
  if (monitoringStartBlock !== null && (!Number.isInteger(monitoringStartBlock) || monitoringStartBlock < 0)) {
    throw new Error('Monitoring start block must be a whole non-negative number');
  }
  const contractAddress = normalizeEvmAddress(input.contractAddress, { label: 'Token contract address' });
  // Deposit/vault addresses are a one-time deployment setting. The admin only
  // types the token address; the deposit contract and vault fall back to the
  // server-configured vault so the operations form stays a single field.
  const depositSource = input.depositContractAddress || input.vaultAddress;
  if (!depositSource) {
    throw new Error('No deposit vault is configured for this deployment. Set RHC_VAULT_ADDRESS (and RHC_DEPOSIT_CONTRACT_ADDRESS if it differs) in the backend environment.');
  }
  const depositContractAddress = normalizeEvmAddress(depositSource, { label: 'Deposit contract address' });
  const vaultAddress = input.vaultAddress
    ? normalizeEvmAddress(input.vaultAddress, { label: 'Deposit vault address' })
    : depositContractAddress;
  if (sameAddress(contractAddress, depositContractAddress)) {
    throw new Error('The token contract and the deposit contract must be different addresses');
  }
  return {
    environment: network.networkType,
    networkId: network.networkId,
    chainId: network.chainId,
    contractAddress,
    checksumAddress: contractAddress,
    addressKey: addressKey(contractAddress),
    depositContractAddress,
    vaultAddress,
    expectedName: String(input.expectedName ?? '').trim().slice(0, 120),
    expectedSymbol: String(input.expectedSymbol ?? '').trim().slice(0, 32),
    expectedDecimals,
    deploymentTransactionHash: String(input.deploymentTransactionHash ?? '').trim().toLowerCase() || null,
    monitoringStartBlock,
    conversionRuleVersion: String(input.conversionRuleVersion ?? '').trim() || 'default',
    activationNote: String(input.activationNote ?? '').trim().slice(0, 500),
  };
}

/**
 * Compare on-chain metadata against what the administrator expected.
 * Mismatches are warnings shown before activation, never silent corrections.
 */
export function metadataWarnings(expected, onChain) {
  const warnings = [];
  if (expected.expectedName && expected.expectedName !== onChain.name) {
    warnings.push(`On-chain name is “${onChain.name}”, the form expected “${expected.expectedName}”.`);
  }
  if (expected.expectedSymbol && expected.expectedSymbol !== onChain.symbol) {
    warnings.push(`On-chain symbol is “${onChain.symbol}”, the form expected “${expected.expectedSymbol}”.`);
  }
  if (expected.expectedDecimals !== null && expected.expectedDecimals !== onChain.decimals) {
    warnings.push(`On-chain decimals are ${onChain.decimals}, the form expected ${expected.expectedDecimals}.`);
  }
  if (onChain.totalSupplyRaw === '0') {
    warnings.push('Total supply is zero. Confirm the token has actually been minted before activation.');
  }
  return warnings;
}

/** Deterministic confirmation phrase for the second activation step (§7.5). */
export function activationConfirmationPhrase(config) {
  const symbol = String(config.symbol || config.expectedSymbol || 'TOKEN').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `ACTIVATE ${symbol} ${config.chainId} v${config.configVersion}`;
}

export function activationPhraseMatches(config, provided) {
  return String(provided ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
    === activationConfirmationPhrase(config).toUpperCase();
}

/**
 * Public projection. This is the only shape the browser is allowed to receive:
 * no RPC keys, no signer reference, no admin roles, no risk thresholds.
 */
export function publicTokenConfig(config) {
  if (!config) return null;
  const network = networkByType(config.environment);
  return {
    networkName: network.networkName,
    networkType: network.networkType,
    chainId: network.chainId,
    chainFamily: network.chainFamily,
    nativeCurrency: { ...network.nativeCurrency },
    publicRpcUrl: network.publicRpcUrl,
    tokenAddress: config.contractAddress,
    tokenName: config.name,
    tokenSymbol: config.symbol,
    tokenDecimals: config.decimals,
    depositContractAddress: config.depositContractAddress,
    vaultAddress: config.vaultAddress,
    explorerUrl: explorerTokenUrl(network, config.contractAddress),
    vaultExplorerUrl: explorerAddressUrl(network, config.vaultAddress),
    explorerBaseUrl: network.explorerBaseUrl,
    status: config.status,
    configVersion: config.configVersion,
    tokenConfigId: config.tokenConfigId,
    conversionRuleVersion: config.conversionRuleVersion,
    activatedAt: config.activatedAt || null,
  };
}

/** A quote is bound to the exact configuration version it was priced against. */
export function quoteMatchesConfig(quote, config) {
  return Boolean(quote && config)
    && quote.tokenConfigId === config.tokenConfigId
    && quote.tokenConfigVersion === config.configVersion
    && Number(quote.chainId) === Number(config.chainId)
    && sameAddress(quote.tokenAddress, config.contractAddress)
    && sameAddress(quote.vaultAddress, config.vaultAddress);
}

export function quoteExpired(quote, now = Date.now()) {
  return !quote || !(Number(quote.expiresAt) > now);
}
