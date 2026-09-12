import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ROBINHOOD_CHAINS, networkByChainId, networkByType, networkForEnvironment,
  walletNetworkMetadata, isSupportedChainId,
} from '../server/chain/networks.js';
import {
  normalizeEvmAddress, addressKey, sameAddress, isEvmAddress, toRawAmount, fromRawAmount,
  rawAmountRecord, formatTokenAmount, normalizeTransactionHash, keccakHex, ZERO_ADDRESS,
} from '../server/chain/evm.js';
import {
  requiredFinalityTag, finalityStatusFor, meetsRequirement, logIdentity,
  assertDepositTransition, assertWithdrawalTransition, canTransitionDeposit,
} from '../server/chain/finality.js';
import {
  normalizeTokenConfigInput, metadataWarnings, activationConfirmationPhrase,
  activationPhraseMatches, publicTokenConfig, quoteMatchesConfig, quoteExpired,
  assertTokenConfigTransition, canTransitionTokenConfig,
} from '../server/chain/tokenConfig.js';
import { createDepositQuote, approvalPlan, depositIdHash } from '../server/chain/quotes.js';
import { evaluateDeposit, DEPOSIT_REJECTIONS } from '../server/chain/depositVerification.js';
import { createChallenge, checkChallengeFields, buildChallengeMessage } from '../server/chain/siwe.js';
import { CONVERSION_RULE_VERSION, fundingTokensFor, withdrawalTokensFor } from '../server/conversion.js';

const TOKEN = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const VAULT = '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359';
const WALLET = '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB';

function activeConfig(overrides = {}) {
  return {
    environment: 'testnet',
    chainId: 46630,
    tokenConfigId: 'tcfg_1',
    configVersion: 3,
    contractAddress: TOKEN,
    depositContractAddress: VAULT,
    vaultAddress: VAULT,
    decimals: 18,
    name: 'Token City',
    symbol: 'TCITY',
    status: 'ACTIVE',
    conversionRuleVersion: CONVERSION_RULE_VERSION,
    ...overrides,
  };
}

test('Robinhood Chain networks use the documented chain ids and gas token', () => {
  assert.equal(ROBINHOOD_CHAINS.mainnet.chainId, 4663);
  assert.equal(ROBINHOOD_CHAINS.testnet.chainId, 46630);
  assert.equal(ROBINHOOD_CHAINS.mainnet.nativeCurrency.symbol, 'ETH');
  assert.equal(networkByChainId(4663).networkType, 'mainnet');
  assert.equal(networkByChainId(46630).networkType, 'testnet');
  assert.ok(isSupportedChainId(4663));
  assert.ok(!isSupportedChainId(1));
  assert.throws(() => networkByChainId(1), /not a Robinhood Chain network/);
});

test('Vercel environments map to the required Robinhood environment', () => {
  assert.equal(networkForEnvironment('production').chainId, 4663);
  assert.equal(networkForEnvironment('preview').chainId, 46630);
  assert.equal(networkForEnvironment('development').chainId, 46630);
  const metadata = walletNetworkMetadata('mainnet');
  assert.equal(metadata.chainId, '0x1237');
  assert.equal(metadata.nativeCurrency.symbol, 'ETH');
  // wallet_addEthereumChain must never carry a paid provider endpoint.
  assert.ok(metadata.rpcUrls.every((url) => !url.includes('alchemy')));
});

test('EVM addresses are checksummed, never Base58, and never the zero address', () => {
  assert.equal(normalizeEvmAddress(TOKEN.toLowerCase()), TOKEN);
  assert.equal(normalizeEvmAddress(`  ${TOKEN}  `), TOKEN);
  assert.ok(sameAddress(TOKEN.toLowerCase(), TOKEN.toUpperCase().replace('0X', '0x')));
  assert.equal(addressKey(TOKEN), TOKEN.toLowerCase());
  assert.throws(() => normalizeEvmAddress(ZERO_ADDRESS), /zero address/);
  // A Solana Base58 public key must never be accepted as an EVM address.
  assert.ok(!isEvmAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'));
  assert.throws(() => normalizeEvmAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'), /valid EVM address/);
  assert.equal(normalizeTransactionHash(`0x${'AB'.repeat(32)}`), `0x${'ab'.repeat(32)}`);
  assert.throws(() => normalizeTransactionHash('0xdeadbeef'), /64 hex/);
  assert.equal(keccakHex('').length, 66);
});

test('raw token amounts are exact integers, never JavaScript floats', () => {
  assert.equal(toRawAmount('0.1', 18), 100000000000000000n);
  assert.equal(toRawAmount('1', 6), 1000000n);
  assert.equal(toRawAmount('1.000000000', 6), 1000000n);   // harmless trailing zeros
  assert.throws(() => toRawAmount('1.0000005', 6), /at most 6 decimal places/);
  assert.throws(() => toRawAmount('-1', 18), /positive decimal/);
  assert.throws(() => toRawAmount('0', 18), /greater than zero/);
  assert.throws(() => toRawAmount('1e18', 18), /positive decimal/);
  assert.equal(fromRawAmount(123456789012345678n, 18), '0.123456789012345678');
  assert.equal(fromRawAmount(0n, 18), '0');
  // Round trip keeps every digit, which a Number would have lost.
  const huge = '123456789.123456789012345678';
  assert.equal(fromRawAmount(toRawAmount(huge, 18), 18), huge);
  const record = rawAmountRecord(toRawAmount('12.5', 18), 18);
  assert.deepEqual(record, { rawAmount: '12500000000000000000', tokenDecimals: 18, displayAmount: '12.5' });
  assert.equal(formatTokenAmount(1234567890123456789012n, 18), '1,234.56789…');
});

test('settlement policy scales with value and never uses a timeout', () => {
  assert.equal(requiredFinalityTag({ networkType: 'testnet', rawAmount: 10n ** 24n, tokenDecimals: 18 }), 'safe');
  assert.equal(requiredFinalityTag({ networkType: 'mainnet', rawAmount: 10n ** 18n * 10n, tokenDecimals: 18 }), 'safe');
  assert.equal(requiredFinalityTag({ networkType: 'mainnet', rawAmount: 10n ** 18n * 5000n, tokenDecimals: 18 }), 'finalized');
  assert.equal(finalityStatusFor({ blockNumber: 100, safeBlockNumber: 90, finalizedBlockNumber: 80 }), 'SOFT_CONFIRMED');
  assert.equal(finalityStatusFor({ blockNumber: 85, safeBlockNumber: 90, finalizedBlockNumber: 80 }), 'SAFE');
  assert.equal(finalityStatusFor({ blockNumber: 70, safeBlockNumber: 90, finalizedBlockNumber: 80 }), 'FINALIZED');
  assert.equal(finalityStatusFor({ blockNumber: 70, safeBlockNumber: null, finalizedBlockNumber: null }), 'SOFT_CONFIRMED');
  assert.ok(meetsRequirement('FINALIZED', 'safe'));
  assert.ok(!meetsRequirement('SOFT_CONFIRMED', 'safe'));
});

test('deposit and withdrawal state machines reject impossible transitions', () => {
  assert.equal(assertDepositTransition('QUOTED', 'SUBMITTED'), 'SUBMITTED');
  assert.equal(assertDepositTransition('SAFE', 'CREDITED'), 'CREDITED');
  assert.ok(!canTransitionDeposit('QUOTED', 'CREDITED'));
  assert.throws(() => assertDepositTransition('CREDITED', 'FAILED'), /cannot move/);
  assert.throws(() => assertDepositTransition('SUBMITTED', 'CREDITED'), /cannot move/);
  assert.equal(assertWithdrawalTransition('QUEUED', 'SUBMITTED'), 'SUBMITTED');
  assert.throws(() => assertWithdrawalTransition('COMPLETED', 'SUBMITTED'), /cannot move/);
});

test('a processed log identity is unique per chain, transaction and log index', () => {
  const hash = `0x${'ab'.repeat(32)}`;
  assert.equal(logIdentity({ chainId: 4663, transactionHash: hash, logIndex: 0 }), `4663:${hash}:0`);
  assert.notEqual(
    logIdentity({ chainId: 4663, transactionHash: hash, logIndex: 0 }),
    logIdentity({ chainId: 4663, transactionHash: hash, logIndex: 1 }),
  );
  assert.notEqual(
    logIdentity({ chainId: 4663, transactionHash: hash, logIndex: 0 }),
    logIdentity({ chainId: 46630, transactionHash: hash, logIndex: 0 }),
  );
  assert.throws(() => logIdentity({ chainId: 4663, transactionHash: hash, logIndex: -1 }), /Log index/);
});

test('token configuration input derives the chain id and rejects unusable addresses', () => {
  const normalized = normalizeTokenConfigInput({
    environment: 'testnet', contractAddress: TOKEN.toLowerCase(),
    depositContractAddress: VAULT.toLowerCase(), expectedSymbol: 'TCITY', expectedDecimals: '18',
  });
  assert.equal(normalized.chainId, 46630);
  assert.equal(normalized.contractAddress, TOKEN);
  assert.equal(normalized.vaultAddress, VAULT);      // defaults to the deposit contract
  assert.throws(() => normalizeTokenConfigInput({
    environment: 'testnet', contractAddress: TOKEN, depositContractAddress: TOKEN,
  }), /must be different addresses/);
  assert.throws(() => normalizeTokenConfigInput({
    environment: 'testnet', contractAddress: ZERO_ADDRESS, depositContractAddress: VAULT,
  }), /zero address/);
  assert.throws(() => normalizeTokenConfigInput({ environment: 'ethereum' }), /Unknown Robinhood Chain environment/);
  // With only a token address and no configured vault, the error is explicit.
  assert.throws(() => normalizeTokenConfigInput({
    environment: 'testnet', contractAddress: TOKEN,
  }), /No deposit vault is configured/);
});

test('metadata mismatches are surfaced as warnings before activation', () => {
  const warnings = metadataWarnings(
    { expectedName: 'Token City', expectedSymbol: 'TCITY', expectedDecimals: 18 },
    { name: 'Other Token', symbol: 'OTHER', decimals: 6, totalSupplyRaw: '0' },
  );
  assert.equal(warnings.length, 4);
  assert.ok(warnings.some((warning) => warning.includes('Total supply is zero')));
});

test('activation requires an exact second confirmation phrase', () => {
  const config = activeConfig();
  assert.equal(activationConfirmationPhrase(config), 'ACTIVATE TCITY 46630 v3');
  assert.ok(activationPhraseMatches(config, ' activate  tcity 46630 v3 '));
  assert.ok(!activationPhraseMatches(config, 'ACTIVATE TCITY 46630 v2'));
});

test('token configuration states follow the documented lifecycle', () => {
  assert.equal(assertTokenConfigTransition('VALIDATED', 'ACTIVE'), 'ACTIVE');
  assert.equal(assertTokenConfigTransition('ACTIVE', 'PAUSED'), 'PAUSED');
  assert.ok(!canTransitionTokenConfig('DRAFT', 'ACTIVE'));
  assert.ok(!canTransitionTokenConfig('RETIRED', 'ACTIVE'));
  assert.throws(() => assertTokenConfigTransition('RETIRED', 'ACTIVE'), /cannot move/);
});

test('the public token configuration never leaks server-only material', () => {
  const published = publicTokenConfig({ ...activeConfig(), rpcApiKey: 'secret', signerReference: 'kms://x' });
  assert.equal(published.chainId, 46630);
  assert.equal(published.tokenAddress, TOKEN);
  assert.ok(published.explorerUrl.startsWith('https://explorer.testnet.chain.robinhood.com/token/'));
  assert.equal(published.rpcApiKey, undefined);
  assert.equal(published.signerReference, undefined);
  assert.equal(JSON.stringify(published).includes('secret'), false);
});

test('a quote is bound to one configuration version and expires', () => {
  const config = activeConfig();
  const quote = createDepositQuote({
    depositId: 'dep_1', gameAccountId: 'acc_1', walletId: 'cw_1', walletAddress: WALLET,
    config, displayTokenAmount: '25', expectedGameCoins: 500,
    conversionRuleVersion: CONVERSION_RULE_VERSION, now: 1_000, ttlMs: 60_000,
  });
  assert.equal(quote.rawTokenAmount, '25000000000000000000');
  assert.equal(quote.depositIdHash, depositIdHash('dep_1'));
  assert.ok(quoteMatchesConfig(quote, config));
  // A new active configuration version invalidates the old quote.
  assert.ok(!quoteMatchesConfig(quote, activeConfig({ configVersion: 4 })));
  assert.ok(!quoteMatchesConfig(quote, activeConfig({ contractAddress: VAULT, depositContractAddress: TOKEN })));
  assert.ok(!quoteExpired(quote, 60_000));
  assert.ok(quoteExpired(quote, 61_001));
});

test('approval asks for the exact amount and resets a stale allowance first', () => {
  const quote = { rawTokenAmount: '1000' };
  assert.deepEqual(approvalPlan({ quote, currentAllowance: '1000' }), {
    required: '1000', needsApproval: false, approveAmount: '0',
  });
  const fresh = approvalPlan({ quote, currentAllowance: '0' });
  assert.equal(fresh.approveAmount, '1000');
  assert.equal(fresh.resetToZeroFirst, false);
  const stale = approvalPlan({ quote, currentAllowance: '5' });
  assert.equal(stale.approveAmount, '1000');       // never unlimited
  assert.equal(stale.resetToZeroFirst, true);
});

// ── independent deposit verification (§11.5) ────────────────────────────────
const HASH = `0x${'11'.repeat(32)}`;

function baseQuote(overrides = {}) {
  return {
    chainId: 46630,
    depositIdHash: depositIdHash('dep_1'),
    depositContractAddress: VAULT,
    tokenAddress: TOKEN,
    walletAddress: WALLET,
    rawTokenAmount: '1000',
    tokenDecimals: 18,
    expiresAt: 10_000,
    ...overrides,
  };
}

function baseReceipt(overrides = {}) {
  return {
    status: 'success',
    to: VAULT,
    transactionHash: HASH,
    blockNumber: 50n,
    blockHash: '0xblock',
    ...overrides,
  };
}

function baseEvent(overrides = {}) {
  return {
    address: VAULT,
    logIndex: 2,
    removed: false,
    wallet: WALLET,
    token: TOKEN,
    depositId: depositIdHash('dep_1'),
    amount: '1000',
    ...overrides,
  };
}

const HEADS = { safeBlockNumber: 100n, finalizedBlockNumber: 90n };

test('a correct deposit is credited exactly once', () => {
  const result = evaluateDeposit({
    quote: baseQuote(), receipt: baseReceipt(), depositedEvents: [baseEvent()],
    canonicalBlockHash: '0xblock', heads: HEADS, networkType: 'testnet', submittedAt: 5_000,
  });
  assert.equal(result.decision, 'credit');
  assert.equal(result.logIdentity, `46630:${HASH}:2`);
  const replay = evaluateDeposit({
    quote: baseQuote(), receipt: baseReceipt(), depositedEvents: [baseEvent()],
    canonicalBlockHash: '0xblock', heads: HEADS, networkType: 'testnet', submittedAt: 5_000,
    creditedLogIds: new Set([`46630:${HASH}:2`]),
  });
  assert.equal(replay.decision, 'reject');
  assert.equal(replay.reason, DEPOSIT_REJECTIONS.ALREADY_CREDITED);
});

test('a transaction hash alone is never proof of a deposit', () => {
  const cases = [
    [{ receipt: null }, DEPOSIT_REJECTIONS.NO_RECEIPT, 'wait'],
    [{ receipt: baseReceipt({ status: 'reverted' }) }, DEPOSIT_REJECTIONS.RECEIPT_FAILED, 'reject'],
    [{ receipt: baseReceipt({ to: TOKEN }) }, DEPOSIT_REJECTIONS.WRONG_CONTRACT, 'reject'],
    [{ depositedEvents: [] }, DEPOSIT_REJECTIONS.NO_EVENT, 'reject'],
    [{ depositedEvents: [baseEvent({ depositId: depositIdHash('dep_other') })] }, DEPOSIT_REJECTIONS.WRONG_DEPOSIT_ID, 'reject'],
    [{ depositedEvents: [baseEvent({ token: VAULT })] }, DEPOSIT_REJECTIONS.WRONG_TOKEN, 'reject'],
    [{ depositedEvents: [baseEvent({ wallet: TOKEN })] }, DEPOSIT_REJECTIONS.WRONG_WALLET, 'reject'],
    [{ depositedEvents: [baseEvent({ amount: '999' })] }, DEPOSIT_REJECTIONS.AMOUNT_MISMATCH, 'reject'],
    [{ submittedAt: 20_000 }, DEPOSIT_REJECTIONS.QUOTE_EXPIRED, 'reject'],
    [{ canonicalBlockHash: '0xother' }, DEPOSIT_REJECTIONS.REORGED, 'reorg'],
  ];
  for (const [override, reason, decision] of cases) {
    const result = evaluateDeposit({
      quote: baseQuote(),
      receipt: baseReceipt(),
      depositedEvents: [baseEvent()],
      canonicalBlockHash: '0xblock',
      heads: HEADS,
      networkType: 'testnet',
      submittedAt: 5_000,
      ...override,
    });
    assert.equal(result.decision, decision, `${reason} decision`);
    assert.equal(result.reason, reason);
  }
});

test('a deposit below the required settlement level waits instead of crediting', () => {
  const result = evaluateDeposit({
    quote: baseQuote(), receipt: baseReceipt({ blockNumber: 120n }), depositedEvents: [baseEvent()],
    canonicalBlockHash: '0xblock', heads: HEADS, networkType: 'testnet', submittedAt: 5_000,
  });
  assert.equal(result.decision, 'wait');
  assert.equal(result.finalityStatus, 'SOFT_CONFIRMED');
  assert.equal(result.requiredTag, 'safe');
});

test('one transaction carrying several logs only settles its own deposit', () => {
  const result = evaluateDeposit({
    quote: baseQuote(),
    receipt: baseReceipt(),
    depositedEvents: [
      baseEvent({ logIndex: 0, depositId: depositIdHash('dep_other'), amount: '77' }),
      baseEvent({ logIndex: 5 }),
    ],
    canonicalBlockHash: '0xblock', heads: HEADS, networkType: 'testnet', submittedAt: 5_000,
  });
  assert.equal(result.decision, 'credit');
  assert.equal(result.event.logIndex, 5);
});

// ── wallet ownership (§9.6) ─────────────────────────────────────────────────
test('a wallet challenge carries every required SIWE field and is single use', () => {
  const challenge = createChallenge({
    domain: 'token-city.vercel.app', uri: 'https://token-city.vercel.app',
    walletAddress: WALLET, chainId: 46630, accountId: 'acc_1',
    randomHex: 'a'.repeat(64), now: 1_000, ttlMs: 60_000,
  });
  for (const field of ['Chain ID: 46630', 'Nonce:', 'Issued At:', 'Expiration Time:', 'Request ID:', 'URI:', 'Version: 1']) {
    assert.ok(challenge.message.includes(field), field);
  }
  assert.ok(challenge.message.includes('never ask for your recovery phrase or private key'));
  assert.equal(buildChallengeMessage(challenge), challenge.message);
  assert.equal(checkChallengeFields({ challenge, walletAddress: WALLET, chainId: 46630, domain: 'token-city.vercel.app', now: 2_000 }), null);
  assert.match(checkChallengeFields({ challenge, walletAddress: WALLET, chainId: 46630, now: 70_000 }), /expired/);
  assert.match(checkChallengeFields({ challenge, walletAddress: VAULT, chainId: 46630, now: 2_000 }), /does not match/);
  assert.match(checkChallengeFields({ challenge, walletAddress: WALLET, chainId: 4663, now: 2_000 }), /different chain/);
  assert.match(checkChallengeFields({ challenge, walletAddress: WALLET, chainId: 46630, domain: 'evil.example', now: 2_000 }), /different site/);
  assert.match(checkChallengeFields({ challenge: { ...challenge, used: true }, walletAddress: WALLET, chainId: 46630, now: 2_000 }), /already used/);
});

test('the conversion rule is versioned and applies the fixed 100:1 rate', () => {
  const funding = fundingTokensFor(1000);
  const withdrawal = withdrawalTokensFor(1000);
  assert.equal(funding.conversionRuleVersion, CONVERSION_RULE_VERSION);
  assert.equal(withdrawal.conversionRuleVersion, CONVERSION_RULE_VERSION);
  assert.ok(Number.isInteger(funding.tokens) && funding.tokens > 0);
  // Fixed rate: 100 tokens == 1 coin, both directions, no fee.
  assert.equal(funding.tokens, 1000 * 100);
  assert.equal(withdrawal.tokens, 1000 * 100);
  assert.equal(funding.tokens, withdrawal.tokens);
  // No Solana base-unit constant leaked into the EVM path.
  assert.equal(JSON.stringify(funding).includes('1000000000'), false);
});
