'use node';
// Every Robinhood Chain network call and the withdrawal signer live here
// (task8 §5, §11.5, §13, §15). Nothing in this file is reachable from the
// browser without either a signed wallet session or the server-to-server
// secret, and no secret is ever returned to a caller.

import { v } from 'convex/values';
import { randomBytes } from 'node:crypto';
import { createWalletClient, defineChain, http, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { action, internalAction } from './_generated/server.js';
import { internal, api } from './_generated/api.js';
import { RobinhoodChainAdapter } from '../server/chain/adapter.js';
import { DEPOSIT_VAULT_ABI } from '../server/chain/abi.js';
import { networkByType, networkForEnvironment } from '../server/chain/networks.js';
import {
  addressKey, fromRawAmount, keccakHex, normalizeEvmAddress, normalizeTransactionHash, sameAddress, toBigInt,
} from '../server/chain/evm.js';
import {
  normalizeTokenConfigInput, metadataWarnings, activationPhraseMatches, publicTokenConfig, quoteExpired,
} from '../server/chain/tokenConfig.js';
import { createChallenge, checkChallengeFields } from '../server/chain/siwe.js';
import { createDepositQuote, createWithdrawalQuote, depositIdHash, approvalPlan } from '../server/chain/quotes.js';
import { evaluateDeposit } from '../server/chain/depositVerification.js';
import { requiredFinalityTag, finalityStatusFor, logIdentity } from '../server/chain/finality.js';
import { fundingTokensFor, withdrawalTokensFor, CONVERSION_RULE_VERSION } from '../server/conversion.js';
import { sessionTokenHash } from '../server/chain/session.js';

function fail(code) { throw new Error(String(code)); }

function assertService(secret) {
  const expected = process.env.CHAIN_SERVICE_SECRET;
  if (!expected) fail('chain-service-secret-not-configured');
  if (String(secret || '') !== expected) fail('chain-service-unauthorized');
}

/** The environment this deployment is allowed to touch (§17). */
export function deploymentNetwork() {
  return networkForEnvironment(process.env.VERCEL_ENV || process.env.CHAIN_ENVIRONMENT || 'development',
    process.env.RHC_ENVIRONMENT || '');
}

function adapterFor(networkType) {
  const network = networkByType(networkType);
  const rpcUrl = network.networkType === 'mainnet'
    ? process.env.RHC_RPC_HTTP_URL_MAINNET || process.env.RHC_RPC_HTTP_URL || ''
    : process.env.RHC_RPC_HTTP_URL_TESTNET || process.env.RHC_RPC_HTTP_URL || '';
  return new RobinhoodChainAdapter({ networkType: network.networkType, rpcUrl });
}

const randomId = (bytes = 16) => randomBytes(bytes).toString('hex');

// ── token administration (§7) ───────────────────────────────────────────────
export const validateTokenContract = action({
  args: { serviceSecret: v.string(), input: v.any(), adminUserId: v.string(), requestId: v.string(), sourceIpHash: v.string() },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    const audit = async (result, failureReason, newConfiguration = null) => {
      await ctx.runMutation(internal.chain.recordAudit, {
        entry: {
          auditId: `aud_${randomId(8)}`,
          adminUserId: args.adminUserId,
          action: 'token-config-validate',
          previousConfiguration: null,
          newConfiguration,
          serverTimestamp: Date.now(),
          requestId: args.requestId,
          sourceIpHash: args.sourceIpHash,
          result,
          failureReason,
        },
      });
    };
    let normalized;
    try {
      // The admin form submits only the token address. The deposit/vault
      // contract is a one-time deployment setting, so fill it from the backend
      // environment when the form leaves those fields empty.
      const input = {
        ...args.input,
        depositContractAddress: args.input.depositContractAddress
          || process.env.RHC_DEPOSIT_CONTRACT_ADDRESS || process.env.RHC_VAULT_ADDRESS || '',
        vaultAddress: args.input.vaultAddress || process.env.RHC_VAULT_ADDRESS || '',
      };
      normalized = normalizeTokenConfigInput(input);
    }
    catch (error) { await audit('rejected', error.message); throw error; }

    const allowed = deploymentNetwork();
    if (normalized.environment !== allowed.networkType) {
      const message = `This deployment may only configure ${allowed.networkName} (${allowed.networkType}).`;
      await audit('rejected', message);
      fail(message);
    }

    const adapter = adapterFor(normalized.environment);
    let metadata;
    try { metadata = await adapter.getTokenMetadata(normalized.contractAddress); }
    catch (error) { await audit('rejected', error.message); throw error; }

    const warnings = metadataWarnings(normalized, metadata);
    if (adapter.usingPublicRpc && normalized.environment === 'mainnet') {
      warnings.push('This deployment is using the public rate-limited RPC. Configure a production provider before mainnet activation.');
    }
    if (!await adapter.hasContractCode(normalized.depositContractAddress)) {
      const message = 'The deposit contract address has no contract code on this chain.';
      await audit('rejected', message);
      fail(message);
    }
    const vault = await adapter.getVaultState({
      depositContractAddress: normalized.depositContractAddress,
      tokenAddress: normalized.contractAddress,
    });
    if (vault.supportedToken === false) warnings.push('The deposit contract does not list this token as supported yet.');
    if (vault.paused === true) warnings.push('The deposit contract is currently paused.');
    if (vault.supportedToken === null) warnings.push('The deposit contract did not answer supportedToken(); confirm it is the reviewed vault.');

    const saved = await ctx.runMutation(internal.chain.saveValidatedConfig, {
      config: {
        tokenConfigId: `tcfg_${randomId(10)}`,
        environment: normalized.environment,
        networkId: normalized.networkId,
        chainId: normalized.chainId,
        contractAddress: metadata.address,
        addressKey: addressKey(metadata.address),
        name: metadata.name,
        symbol: metadata.symbol,
        decimals: metadata.decimals,
        totalSupplyAtValidation: metadata.totalSupplyRaw,
        depositContractAddress: normalized.depositContractAddress,
        vaultAddress: normalized.vaultAddress,
        monitoringStartBlock: normalized.monitoringStartBlock,
        conversionRuleVersion: normalized.conversionRuleVersion === 'default'
          ? CONVERSION_RULE_VERSION : normalized.conversionRuleVersion,
        activationNote: normalized.activationNote,
        warnings,
      },
    });
    await audit('validated', null, { tokenConfigId: saved.tokenConfigId, configVersion: saved.configVersion });
    return {
      tokenConfigId: saved.tokenConfigId,
      configVersion: saved.configVersion,
      status: saved.status,
      chainId: saved.chainId,
      name: saved.name,
      symbol: saved.symbol,
      decimals: saved.decimals,
      totalSupplyDisplay: metadata.totalSupplyDisplay,
      explorerUrl: metadata.explorerUrl,
      vaultExplorerUrl: adapter.getExplorerUrl('address', saved.vaultAddress),
      warnings,
      vault,
      usingPublicRpc: adapter.usingPublicRpc,
    };
  },
});

export const activateTokenConfig = action({
  args: {
    serviceSecret: v.string(), tokenConfigId: v.string(), confirmationPhrase: v.string(),
    adminUserId: v.string(), requestId: v.string(), sourceIpHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    const row = await ctx.runQuery(internal.chain.tokenConfigById, { tokenConfigId: args.tokenConfigId });
    if (!row) fail('token-config-not-found');
    const auditEntry = (result, failureReason, newConfiguration) => ({
      entry: {
        auditId: `aud_${randomId(8)}`,
        adminUserId: args.adminUserId,
        action: 'token-config-activate',
        previousConfiguration: { tokenConfigId: row.tokenConfigId, status: row.status, configVersion: row.configVersion },
        newConfiguration,
        serverTimestamp: Date.now(),
        requestId: args.requestId,
        sourceIpHash: args.sourceIpHash,
        result,
        failureReason,
      },
    });
    if (!activationPhraseMatches(row, args.confirmationPhrase)) {
      await ctx.runMutation(internal.chain.recordAudit, auditEntry('rejected', 'confirmation-phrase-mismatch', null));
      fail('The confirmation phrase does not match. Activation was not applied.');
    }
    const result = await ctx.runMutation(internal.chain.activateConfig, {
      tokenConfigId: args.tokenConfigId, adminUserId: args.adminUserId,
    });
    await ctx.runMutation(internal.chain.recordAudit, auditEntry('activated', null, {
      tokenConfigId: result.activated.tokenConfigId,
      configVersion: result.activated.configVersion,
      pausedPrevious: result.previous?.tokenConfigId || null,
    }));
    return { active: publicTokenConfig(result.activated), pausedPrevious: result.previous?.tokenConfigId || null };
  },
});

export const setTokenConfigStatus = action({
  args: {
    serviceSecret: v.string(), tokenConfigId: v.string(), status: v.string(),
    adminUserId: v.string(), requestId: v.string(), sourceIpHash: v.string(),
  },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    let updated = null;
    let failure = null;
    try { updated = await ctx.runMutation(internal.chain.setConfigStatus, { tokenConfigId: args.tokenConfigId, status: args.status }); }
    catch (error) { failure = error.message; }
    await ctx.runMutation(internal.chain.recordAudit, {
      entry: {
        auditId: `aud_${randomId(8)}`,
        adminUserId: args.adminUserId,
        action: `token-config-${args.status.toLowerCase()}`,
        previousConfiguration: { tokenConfigId: args.tokenConfigId },
        newConfiguration: updated ? { status: updated.status, configVersion: updated.configVersion } : null,
        serverTimestamp: Date.now(),
        requestId: args.requestId,
        sourceIpHash: args.sourceIpHash,
        result: failure ? 'rejected' : 'applied',
        failureReason: failure,
      },
    });
    if (failure) fail(failure);
    return publicTokenConfig(updated);
  },
});

// ── wallet ownership (§9.6) ─────────────────────────────────────────────────
export const issueWalletChallenge = action({
  args: { accountId: v.string(), walletAddress: v.string(), chainId: v.number(), domain: v.string(), uri: v.string() },
  handler: async (ctx, args) => {
    const network = deploymentNetwork();
    if (Number(args.chainId) !== network.chainId) {
      fail(`Switch your wallet to ${network.networkName} (chain id ${network.chainId}) before signing in.`);
    }
    const challenge = createChallenge({
      domain: args.domain,
      uri: args.uri,
      walletAddress: args.walletAddress,
      chainId: network.chainId,
      accountId: args.accountId,
      randomHex: randomId(32),
    });
    await ctx.runMutation(internal.chain.storeChallenge, { challenge });
    return { nonce: challenge.nonce, requestId: challenge.requestId, message: challenge.message, expiresAt: challenge.expiresAt };
  },
});

export const verifyWalletChallenge = action({
  args: {
    accountId: v.string(), walletAddress: v.string(), nonce: v.string(),
    signature: v.string(), providerType: v.string(), domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const network = deploymentNetwork();
    const challenge = await ctx.runQuery(internal.chain.challengeByNonce, { nonce: args.nonce });
    const fieldError = checkChallengeFields({
      challenge, walletAddress: args.walletAddress, chainId: network.chainId, domain: args.domain,
    });
    if (fieldError) fail(fieldError);

    const address = normalizeEvmAddress(args.walletAddress, { label: 'Wallet address' });
    let valid = false;
    try {
      valid = await verifyMessage({ address, message: challenge.message, signature: args.signature });
    } catch { valid = false; }
    if (!valid) {
      // ERC-1271 contract wallets answer through the chain rather than ecrecover.
      try {
        const adapter = adapterFor(network.networkType);
        valid = await adapter.client.verifyMessage({ address, message: challenge.message, signature: args.signature });
      } catch { valid = false; }
    }
    if (!valid) fail('The signature does not match this wallet.');

    const sessionToken = randomId(32);
    const link = await ctx.runMutation(internal.chain.completeWalletLink, {
      nonce: args.nonce,
      accountId: args.accountId,
      walletAddress: address,
      chainId: network.chainId,
      providerType: String(args.providerType || 'unknown').slice(0, 40),
      sessionTokenHash: sessionTokenHash(sessionToken),
      walletIdSeed: randomId(8),
    });
    return { ...link, sessionToken };
  },
});

// ── balances (§10) ──────────────────────────────────────────────────────────
export const walletBalances = action({
  args: { walletAddress: v.string() },
  handler: async (ctx, args) => {
    const network = deploymentNetwork();
    const config = await ctx.runQuery(api.chain.activeTokenConfig, { environment: network.networkType });
    const adapter = adapterFor(network.networkType);
    const native = await adapter.getNativeBalance(args.walletAddress);
    if (!config) return { chainId: network.chainId, native, token: null, config: null };
    const token = await adapter.getTokenBalance(config.tokenAddress, args.walletAddress);
    return {
      chainId: network.chainId,
      native,
      token,
      config,
      walletExplorerUrl: adapter.getExplorerUrl('address', normalizeEvmAddress(args.walletAddress)),
    };
  },
});

// ── deposits (§11) ──────────────────────────────────────────────────────────
async function requireSession(ctx, accountId, sessionToken) {
  const session = await ctx.runQuery(internal.chain.sessionByToken, { accountId, sessionToken });
  if (!session) fail('wallet-session-required');
  return session;
}

export const quoteDeposit = action({
  args: { accountId: v.string(), sessionToken: v.string(), walletId: v.string(), coins: v.number() },
  handler: async (ctx, args) => {
    const session = await requireSession(ctx, args.accountId, args.sessionToken);
    const coins = Math.trunc(Number(args.coins));
    if (!Number.isFinite(coins) || coins <= 0 || coins > 10_000_000) fail('invalid-deposit-amount');
    const wallet = await ctx.runQuery(internal.chain.walletByIdInternal, { walletId: args.walletId });
    if (!wallet || wallet.gameAccountId !== args.accountId || wallet.status !== 'linked') fail('wallet-not-linked');
    if (wallet.walletId !== session.walletId) fail('sign-in-with-this-wallet-first');

    const network = deploymentNetwork();
    const config = await ctx.runQuery(api.chain.activeTokenConfig, { environment: network.networkType });
    if (!config) fail('No project token is active for this environment yet.');

    const priced = fundingTokensFor(coins, {});
    const quote = createDepositQuote({
      depositId: `dep_${randomId(16)}`,
      gameAccountId: args.accountId,
      walletId: wallet.walletId,
      walletAddress: wallet.address,
      config: {
        environment: network.networkType,
        tokenConfigId: config.tokenConfigId,
        configVersion: config.configVersion,
        contractAddress: config.tokenAddress,
        depositContractAddress: config.depositContractAddress,
        vaultAddress: config.vaultAddress,
        decimals: config.tokenDecimals,
      },
      displayTokenAmount: String(priced.tokens),
      expectedGameCoins: coins,
      conversionRuleVersion: priced.conversionRuleVersion,
    });

    const adapter = adapterFor(network.networkType);
    const [balance, native, allowance] = await Promise.all([
      adapter.getTokenBalance(config.tokenAddress, wallet.address),
      adapter.getNativeBalance(wallet.address),
      adapter.getAllowance(config.tokenAddress, wallet.address, config.depositContractAddress),
    ]);
    const approval = approvalPlan({ quote, currentAllowance: allowance });

    await ctx.runMutation(internal.chain.insertDeposit, {
      deposit: {
        depositId: quote.depositId,
        depositIdHash: quote.depositIdHash,
        gameAccountId: quote.gameAccountId,
        walletId: quote.walletId,
        walletAddress: quote.walletAddress,
        chainId: quote.chainId,
        tokenConfigId: quote.tokenConfigId,
        tokenConfigVersion: quote.tokenConfigVersion,
        tokenAddress: quote.tokenAddress,
        depositContractAddress: quote.depositContractAddress,
        vaultAddress: quote.vaultAddress,
        rawAmount: quote.rawTokenAmount,
        tokenDecimals: quote.tokenDecimals,
        expectedGameCoins: quote.expectedGameCoins,
        conversionRuleVersion: quote.conversionRuleVersion,
        transactionHash: null,
        logIndex: null,
        blockNumber: null,
        blockHash: null,
        finalityStatus: null,
        requiredFinalityTag: requiredFinalityTag({
          networkType: network.networkType,
          rawAmount: toBigInt(quote.rawTokenAmount),
          tokenDecimals: quote.tokenDecimals,
        }),
        status: 'QUOTED',
        failureReason: null,
        quoteExpiresAt: quote.expiresAt,
        creditedAt: null,
        createdAt: quote.createdAt,
        updatedAt: quote.createdAt,
      },
    });

    const sufficientToken = toBigInt(balance.rawAmount) >= toBigInt(quote.rawTokenAmount);
    return {
      quote: { ...quote, depositIdHash: quote.depositIdHash },
      approval,
      balances: { token: balance, native },
      sufficientToken,
      // A wallet that holds the token but no ETH cannot approve or deposit.
      gasWarning: toBigInt(native.rawAmount) === 0n
        ? 'This wallet has no ETH on Robinhood Chain. Add ETH for gas before approving or depositing.'
        : null,
      explorer: {
        token: adapter.getExplorerUrl('token', config.tokenAddress),
        vault: adapter.getExplorerUrl('address', config.vaultAddress),
      },
    };
  },
});

async function verifyOne(ctx, deposit, { networkType }) {
  const adapter = adapterFor(networkType);
  const receipt = deposit.transactionHash ? await adapter.getTransactionReceipt(deposit.transactionHash) : null;
  const events = receipt ? adapter.decodeDepositedEvents(receipt, deposit.depositContractAddress) : [];
  const [heads, canonicalBlockHash] = receipt
    ? await Promise.all([adapter.getFinalityHeads(), adapter.getCanonicalBlockHash(receipt.blockNumber)])
    : [{ safeBlockNumber: null, finalizedBlockNumber: null }, null];
  const credited = receipt
    ? await ctx.runQuery(internal.chain.creditedLogIds, {
      chainId: deposit.chainId, transactionHash: deposit.transactionHash,
    })
    : [];
  let submittedAt = null;
  if (receipt) {
    try {
      const block = await adapter.client.getBlock({ blockNumber: receipt.blockNumber });
      submittedAt = Number(block.timestamp) * 1000;
    } catch { submittedAt = null; }
  }
  const outcome = evaluateDeposit({
    quote: {
      chainId: deposit.chainId,
      depositIdHash: deposit.depositIdHash,
      depositContractAddress: deposit.depositContractAddress,
      tokenAddress: deposit.tokenAddress,
      walletAddress: deposit.walletAddress,
      rawTokenAmount: deposit.rawAmount,
      tokenDecimals: deposit.tokenDecimals,
      expiresAt: deposit.quoteExpiresAt,
    },
    receipt,
    depositedEvents: events,
    canonicalBlockHash,
    heads,
    creditedLogIds: credited,
    networkType,
    submittedAt,
  });

  if (outcome.event) {
    await ctx.runMutation(internal.chain.recordProcessedLog, {
      log: {
        logId: logIdentity({
          chainId: deposit.chainId, transactionHash: receipt.transactionHash, logIndex: outcome.event.logIndex,
        }),
        chainId: deposit.chainId,
        transactionHash: receipt.transactionHash,
        logIndex: outcome.event.logIndex,
        contractAddress: deposit.depositContractAddress,
        eventName: 'Deposited',
        blockNumber: String(receipt.blockNumber),
        blockHash: receipt.blockHash,
        removed: Boolean(outcome.event.removed),
        depositId: outcome.decision === 'credit' ? deposit.depositId : null,
      },
    });
  }

  const applied = await ctx.runMutation(internal.chain.applyDepositResult, {
    depositId: deposit.depositId,
    status: outcome.decision === 'credit' ? 'CREDITED' : outcome.status,
    finalityStatus: outcome.finalityStatus || null,
    transactionHash: receipt ? receipt.transactionHash : deposit.transactionHash,
    logIndex: outcome.event ? Number(outcome.event.logIndex) : null,
    blockNumber: receipt ? String(receipt.blockNumber) : null,
    blockHash: receipt ? receipt.blockHash : null,
    failureReason: outcome.reason || null,
    credit: outcome.decision === 'credit',
  });
  return { outcome, applied };
}

export const submitDeposit = action({
  args: { accountId: v.string(), sessionToken: v.string(), depositId: v.string(), transactionHash: v.string() },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.accountId, args.sessionToken);
    const deposit = await ctx.runQuery(internal.chain.depositByIdInternal, { depositId: args.depositId });
    if (!deposit || deposit.gameAccountId !== args.accountId) fail('deposit-not-found');
    if (deposit.status === 'CREDITED') return { status: 'CREDITED', expectedGameCoins: deposit.expectedGameCoins };
    const hash = normalizeTransactionHash(args.transactionHash);
    // The hash only tells the backend where to look; every fact below is read
    // from the chain itself.
    if (deposit.status === 'QUOTED') {
      await ctx.runMutation(internal.chain.applyDepositResult, {
        depositId: deposit.depositId,
        status: 'SUBMITTED',
        finalityStatus: null,
        transactionHash: hash,
        logIndex: null,
        blockNumber: null,
        blockHash: null,
        failureReason: null,
        credit: false,
      });
    }
    const network = deploymentNetwork();
    const fresh = await ctx.runQuery(internal.chain.depositByIdInternal, { depositId: args.depositId });
    const { outcome, applied } = await verifyOne(ctx, { ...fresh, transactionHash: hash }, { networkType: network.networkType });
    return {
      status: applied.deposit.status,
      decision: outcome.decision,
      reason: outcome.reason || null,
      finalityStatus: applied.deposit.finalityStatus,
      requiredFinalityTag: applied.deposit.requiredFinalityTag,
      expectedGameCoins: applied.deposit.expectedGameCoins,
      transactionHash: applied.deposit.transactionHash,
      explorerUrl: adapterFor(network.networkType).getExplorerUrl('tx', hash),
    };
  },
});

export const refreshDeposit = action({
  args: { accountId: v.string(), sessionToken: v.string(), depositId: v.string() },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.accountId, args.sessionToken);
    const deposit = await ctx.runQuery(internal.chain.depositByIdInternal, { depositId: args.depositId });
    if (!deposit || deposit.gameAccountId !== args.accountId) fail('deposit-not-found');
    if (!deposit.transactionHash || deposit.status === 'CREDITED') {
      return { status: deposit.status, expectedGameCoins: deposit.expectedGameCoins };
    }
    const network = deploymentNetwork();
    const { applied } = await verifyOne(ctx, deposit, { networkType: network.networkType });
    return {
      status: applied.deposit.status,
      finalityStatus: applied.deposit.finalityStatus,
      expectedGameCoins: applied.deposit.expectedGameCoins,
      transactionHash: applied.deposit.transactionHash,
    };
  },
});

// ── withdrawals (§13) ───────────────────────────────────────────────────────
export const requestWithdrawal = action({
  args: {
    accountId: v.string(), sessionToken: v.string(), walletId: v.string(),
    coins: v.number(), idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.accountId, args.sessionToken);
    const coins = Math.trunc(Number(args.coins));
    if (!Number.isFinite(coins) || coins <= 0 || coins > 10_000_000) fail('invalid-withdrawal-amount');
    const wallet = await ctx.runQuery(internal.chain.walletByIdInternal, { walletId: args.walletId });
    if (!wallet || wallet.gameAccountId !== args.accountId || wallet.status !== 'linked') fail('wallet-not-linked');

    const network = deploymentNetwork();
    const config = await ctx.runQuery(api.chain.activeTokenConfig, { environment: network.networkType });
    if (!config) fail('No project token is active for this environment yet.');
    const priced = withdrawalTokensFor(coins, {});
    if (priced.tokens <= 0) fail('withdrawal-amount-too-small');

    const quote = createWithdrawalQuote({
      withdrawalId: `wdr_${randomId(16)}`,
      gameAccountId: args.accountId,
      walletId: wallet.walletId,
      walletAddress: wallet.address,
      config: {
        environment: network.networkType,
        tokenConfigId: config.tokenConfigId,
        configVersion: config.configVersion,
        contractAddress: config.tokenAddress,
        vaultAddress: config.vaultAddress,
        decimals: config.tokenDecimals,
      },
      gameCoinAmount: coins,
      displayTokenAmount: String(priced.tokens),
      conversionRuleVersion: priced.conversionRuleVersion,
      idempotencyKey: String(args.idempotencyKey).slice(0, 80),
    });

    const adapter = adapterFor(network.networkType);
    const vaultBalance = await adapter.getTokenBalance(config.tokenAddress, config.vaultAddress);
    if (toBigInt(vaultBalance.rawAmount) < toBigInt(quote.rawTokenAmount)) {
      fail('The token vault does not currently hold enough tokens for this withdrawal. Try a smaller amount or retry later.');
    }

    const stored = await ctx.runMutation(internal.chain.insertWithdrawal, {
      withdrawal: {
        withdrawalId: quote.withdrawalId,
        idempotencyKey: quote.idempotencyKey,
        gameAccountId: quote.gameAccountId,
        walletId: quote.walletId,
        walletAddress: quote.walletAddress,
        chainId: quote.chainId,
        tokenConfigId: quote.tokenConfigId,
        tokenConfigVersion: quote.tokenConfigVersion,
        tokenAddress: quote.tokenAddress,
        vaultAddress: quote.vaultAddress,
        rawAmount: quote.rawTokenAmount,
        tokenDecimals: quote.tokenDecimals,
        gameCoinAmount: quote.gameCoinAmount,
        conversionRuleVersion: quote.conversionRuleVersion,
        transactionHash: null,
        blockNumber: null,
        blockHash: null,
        finalityStatus: null,
        status: 'QUEUED',
        failureCode: null,
        quoteExpiresAt: quote.expiresAt,
        createdAt: quote.createdAt,
        submittedAt: null,
        completedAt: null,
        updatedAt: quote.createdAt,
      },
    });
    // The queue is drained by the scheduled worker, so a closed browser tab
    // never strands a withdrawal that was already accepted.
    await ctx.scheduler.runAfter(0, internal.chainActions.processWithdrawalQueue, {});
    return {
      withdrawalId: stored.withdrawal.withdrawalId,
      duplicate: stored.duplicate,
      status: stored.withdrawal.status,
      displayTokenAmount: fromRawAmount(stored.withdrawal.rawAmount, stored.withdrawal.tokenDecimals),
      gameCoinAmount: stored.withdrawal.gameCoinAmount,
      walletAddress: stored.withdrawal.walletAddress,
    };
  },
});

/**
 * Signer access. A private key in an environment variable is acceptable for
 * development and testnet only; production must point RHC_SIGNER_REFERENCE at
 * the approved managed signer before mainnet activation (§13.3).
 */
function signerAccount(network) {
  const key = process.env.RHC_SIGNER_PRIVATE_KEY || '';
  if (!key) return null;
  if (network.networkType === 'mainnet' && process.env.RHC_ALLOW_ENV_SIGNER_ON_MAINNET !== 'true') {
    throw new Error('A raw environment signer is not allowed on mainnet. Configure the approved managed signer.');
  }
  return privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
}

function walletClientFor(network, account) {
  const rpcUrl = network.networkType === 'mainnet'
    ? process.env.RHC_RPC_HTTP_URL_MAINNET || process.env.RHC_RPC_HTTP_URL || network.publicRpcUrl
    : process.env.RHC_RPC_HTTP_URL_TESTNET || process.env.RHC_RPC_HTTP_URL || network.publicRpcUrl;
  return createWalletClient({
    account,
    chain: defineChain({
      id: network.chainId,
      name: network.networkName,
      nativeCurrency: { ...network.nativeCurrency },
      rpcUrls: { default: { http: [rpcUrl] } },
    }),
    transport: http(rpcUrl),
  });
}

export const processWithdrawalQueue = internalAction({
  args: {},
  handler: async (ctx) => {
    const network = deploymentNetwork();
    const adapter = adapterFor(network.networkType);
    const rows = await ctx.runQuery(internal.chain.openWithdrawals, { limit: 10 });
    let account = null;
    try { account = signerAccount(network); }
    catch (error) {
      for (const row of rows.filter((entry) => entry.status === 'QUEUED')) {
        await ctx.runMutation(internal.chain.applyWithdrawalResult, {
          withdrawalId: row.withdrawalId, status: 'MANUAL_REVIEW', finalityStatus: null,
          transactionHash: null, blockNumber: null, blockHash: null, failureCode: 'signer-not-authorized',
        });
      }
      return { processed: 0, error: error.message };
    }

    let processed = 0;
    for (const row of rows) {
      if (row.status === 'QUEUED') {
        if (!account) {
          await ctx.runMutation(internal.chain.applyWithdrawalResult, {
            withdrawalId: row.withdrawalId, status: 'MANUAL_REVIEW', finalityStatus: null,
            transactionHash: null, blockNumber: null, blockHash: null, failureCode: 'signer-not-configured',
          });
          continue;
        }
        // Never send twice for one withdrawal: the on-chain id is derived from
        // the withdrawal id and the vault rejects a replay.
        const withdrawalIdHash = keccakHex(row.withdrawalId);
        const config = await ctx.runQuery(internal.chain.tokenConfigById, { tokenConfigId: row.tokenConfigId });
        const request = adapter.buildWithdrawal({
          depositContractAddress: config.depositContractAddress,
          tokenAddress: row.tokenAddress,
          to: row.walletAddress,
          rawAmount: row.rawAmount,
          withdrawalIdHash,
        });
        const alreadyUsed = await adapter.client.readContract({
          address: request.address, abi: DEPOSIT_VAULT_ABI, functionName: 'withdrawalUsed', args: [withdrawalIdHash],
        }).catch(() => null);
        if (alreadyUsed === true) {
          await ctx.runMutation(internal.chain.applyWithdrawalResult, {
            withdrawalId: row.withdrawalId, status: 'MANUAL_REVIEW', finalityStatus: null,
            transactionHash: null, blockNumber: null, blockHash: null, failureCode: 'withdrawal-id-already-used-on-chain',
          });
          continue;
        }
        const gas = await adapter.getNativeBalance(account.address);
        if (toBigInt(gas.rawAmount) === 0n) {
          await ctx.runMutation(internal.chain.applyWithdrawalResult, {
            withdrawalId: row.withdrawalId, status: 'MANUAL_REVIEW', finalityStatus: null,
            transactionHash: null, blockNumber: null, blockHash: null, failureCode: 'signer-has-no-eth-for-gas',
          });
          continue;
        }
        let hash = null;
        try {
          const client = walletClientFor(network, account);
          hash = await client.writeContract({ ...request, account, chain: client.chain });
        } catch (error) {
          // No transaction exists yet, so releasing the internal lock is safe.
          await ctx.runMutation(internal.chain.applyWithdrawalResult, {
            withdrawalId: row.withdrawalId, status: 'FAILED', finalityStatus: null,
            transactionHash: null, blockNumber: null, blockHash: null,
            failureCode: String(error.shortMessage || error.message).slice(0, 200),
          });
          continue;
        }
        await ctx.runMutation(internal.chain.applyWithdrawalResult, {
          withdrawalId: row.withdrawalId, status: 'SUBMITTED', finalityStatus: null,
          transactionHash: hash, blockNumber: null, blockHash: null, failureCode: null,
        });
        processed += 1;
        continue;
      }

      if (!row.transactionHash) continue;
      const receipt = await adapter.getTransactionReceipt(row.transactionHash);
      if (!receipt) continue;   // pending: never resubmit, only keep watching
      if (receipt.status !== 'success') {
        await ctx.runMutation(internal.chain.applyWithdrawalResult, {
          withdrawalId: row.withdrawalId, status: 'FAILED', finalityStatus: null,
          transactionHash: row.transactionHash, blockNumber: String(receipt.blockNumber),
          blockHash: receipt.blockHash, failureCode: 'withdrawal-transaction-reverted',
        });
        continue;
      }
      const heads = await adapter.getFinalityHeads();
      const finalityStatus = finalityStatusFor({
        blockNumber: receipt.blockNumber,
        safeBlockNumber: heads.safeBlockNumber,
        finalizedBlockNumber: heads.finalizedBlockNumber,
      });
      // A withdrawal walks the settlement ladder one documented step per pass:
      // SUBMITTED records what the chain reports, and only a withdrawal that
      // has already reached a settlement state is marked COMPLETED.
      const nextStatus = row.status === 'SUBMITTED'
        ? finalityStatus
        : finalityStatus === 'SOFT_CONFIRMED' ? 'SOFT_CONFIRMED' : 'COMPLETED';
      await ctx.runMutation(internal.chain.applyWithdrawalResult, {
        withdrawalId: row.withdrawalId,
        status: nextStatus,
        finalityStatus,
        transactionHash: row.transactionHash,
        blockNumber: String(receipt.blockNumber),
        blockHash: receipt.blockHash,
        failureCode: null,
      });
      processed += 1;
    }
    return { processed };
  },
});

// ── ingestion and reconciliation (§15) ──────────────────────────────────────
export const reconcileChain = internalAction({
  args: {},
  handler: async (ctx) => {
    const network = deploymentNetwork();
    const published = await ctx.runQuery(api.chain.activeTokenConfig, { environment: network.networkType });
    if (!published) return { skipped: 'no-active-token-config' };
    // The monitoring start block is server-only, so the internal row is read
    // rather than the sanitized public projection.
    const config = await ctx.runQuery(internal.chain.tokenConfigById, { tokenConfigId: published.tokenConfigId });
    if (!config) return { skipped: 'token-config-row-missing' };
    const adapter = adapterFor(network.networkType);
    const workerId = `convex_${randomId(4)}`;
    const cursorId = `${network.chainId}:${addressKey(config.depositContractAddress)}`;
    const cursor = await ctx.runQuery(internal.chain.readCursor, { cursorId });
    const heads = await adapter.getFinalityHeads();
    const latest = toBigInt(heads.latestBlockNumber || '0');

    // A restart resumes from the persisted block, never from memory, and a
    // deployment that missed blocks backfills them in bounded ranges.
    const startBlock = cursor
      ? toBigInt(cursor.lastProcessedBlock) + 1n
      : toBigInt(config.monitoringStartBlock ?? Number(latest > 5000n ? latest - 5000n : 0n));
    const MAX_RANGE = 2000n;
    const toBlock = startBlock + MAX_RANGE > latest ? latest : startBlock + MAX_RANGE;
    let scanned = 0;
    if (toBlock >= startBlock) {
      const logs = await adapter.client.getLogs({
        address: config.depositContractAddress,
        fromBlock: startBlock,
        toBlock,
      }).catch(() => []);
      for (const log of logs) {
        await ctx.runMutation(internal.chain.recordProcessedLog, {
          log: {
            logId: logIdentity({ chainId: network.chainId, transactionHash: log.transactionHash, logIndex: Number(log.logIndex) }),
            chainId: network.chainId,
            transactionHash: log.transactionHash,
            logIndex: Number(log.logIndex),
            contractAddress: config.depositContractAddress,
            eventName: 'ChainLog',
            blockNumber: String(log.blockNumber),
            blockHash: log.blockHash,
            removed: Boolean(log.removed),
            depositId: null,
          },
        });
        scanned += 1;
      }
      const tipHash = await adapter.getCanonicalBlockHash(toBlock);
      await ctx.runMutation(internal.chain.writeCursor, {
        cursorId,
        chainId: network.chainId,
        contractAddress: config.depositContractAddress,
        lastProcessedBlock: toBlock.toString(),
        lastProcessedBlockHash: tipHash,
        workerId,
      });
    }

    // Re-verify every unresolved deposit against canonical chain data.
    const open = await ctx.runQuery(internal.chain.openDeposits, { limit: 20 });
    let rechecked = 0;
    for (const deposit of open) {
      if (!deposit.transactionHash) continue;
      await verifyOne(ctx, deposit, { networkType: network.networkType });
      rechecked += 1;
    }
    await ctx.runMutation(internal.chain.pruneChainState, {});

    const vaultBalance = await adapter.getTokenBalance(config.contractAddress, config.vaultAddress).catch(() => null);
    let signerBalance = null;
    try {
      const account = signerAccount(network);
      if (account) signerBalance = await adapter.getNativeBalance(account.address);
    } catch { signerBalance = null; }

    return {
      chainId: network.chainId,
      scannedLogs: scanned,
      recheckedDeposits: rechecked,
      cursorBlock: toBlock.toString(),
      latestBlock: heads.latestBlockNumber,
      safeBlock: heads.safeBlockNumber,
      finalizedBlock: heads.finalizedBlockNumber,
      vaultTokenBalance: vaultBalance?.displayAmount ?? null,
      signerGasBalance: signerBalance?.displayAmount ?? null,
      usingPublicRpc: adapter.usingPublicRpc,
    };
  },
});

/** Read-only health snapshot for the protected admin page (§24). */
export const chainHealth = action({
  args: { serviceSecret: v.string() },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    const network = deploymentNetwork();
    const adapter = adapterFor(network.networkType);
    const config = await ctx.runQuery(api.chain.activeTokenConfig, { environment: network.networkType });
    const started = Date.now();
    let heads = null;
    let rpcError = null;
    try { heads = await adapter.getFinalityHeads(); }
    catch (error) { rpcError = String(error.shortMessage || error.message).slice(0, 200); }
    const vault = config ? await adapter.getTokenBalance(config.tokenAddress, config.vaultAddress).catch(() => null) : null;
    let signer = null;
    try {
      const account = signerAccount(network);
      if (account) {
        const balance = await adapter.getNativeBalance(account.address);
        signer = { address: account.address, eth: balance.displayAmount };
      }
    } catch (error) { signer = { error: error.message }; }
    return {
      networkName: network.networkName,
      chainId: network.chainId,
      environment: network.networkType,
      rpcLatencyMs: Date.now() - started,
      rpcError,
      usingPublicRpc: adapter.usingPublicRpc,
      heads,
      activeTokenConfig: config,
      vaultTokenBalance: vault?.displayAmount ?? null,
      signer,
    };
  },
});
