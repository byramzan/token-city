// Durable Robinhood Chain state (task8 §15.3, §16.1, §18).
//
// This module holds the canonical records. It never talks to an RPC endpoint:
// every chain fact arrives from `chainActions.js`, which is the only place
// allowed to make network calls or hold a signer. Queries here are what the
// browser subscribes to, so a status change reaches the player over the
// existing Convex WebSocket without a second real-time system.

import { v } from 'convex/values';
import { mutation, query, internalMutation, internalQuery } from './_generated/server.js';
import { addressKey, sameAddress } from '../server/chain/evm.js';
import { SESSION_TTL_MS, sessionTokenHash } from '../server/chain/session.js';
import { publicTokenConfig, assertTokenConfigTransition } from '../server/chain/tokenConfig.js';
import { assertDepositTransition, assertWithdrawalTransition, logIdentity } from '../server/chain/finality.js';

export function chainFail(code) {
  throw new Error(String(code));
}

const SERVICE_SECRET_ENV = 'CHAIN_SERVICE_SECRET';

/** Server-to-server calls (admin API, indexer) carry a shared secret. */
function assertService(secret) {
  const expected = process.env[SERVICE_SECRET_ENV];
  if (!expected) chainFail('chain-service-secret-not-configured');
  if (String(secret || '') !== expected) chainFail('chain-service-unauthorized');
}

async function sessionRow(ctx, sessionToken) {
  if (!sessionToken) return null;
  const row = await ctx.db.query('chainSessions')
    .withIndex('by_token_hash', (q) => q.eq('tokenHash', sessionTokenHash(sessionToken)))
    .first();
  if (!row || row.revokedAt || row.expiresAt <= Date.now()) return null;
  return row;
}

/** Authorize a private chain request from the browser. */
async function authorize(ctx, { accountId, sessionToken }) {
  const row = await sessionRow(ctx, sessionToken);
  if (!row || row.accountId !== accountId) chainFail('wallet-session-required');
  return row;
}

// ── token configuration ─────────────────────────────────────────────────────
async function activeConfigRow(ctx, environment) {
  return ctx.db.query('tokenConfigs')
    .withIndex('by_environment_status', (q) => q.eq('environment', environment).eq('status', 'ACTIVE'))
    .first();
}

export const activeTokenConfig = query({
  args: { environment: v.string() },
  handler: async (ctx, args) => publicTokenConfig(await activeConfigRow(ctx, args.environment)),
});

export const tokenConfigList = query({
  args: { environment: v.string(), serviceSecret: v.string() },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    const rows = await ctx.db.query('tokenConfigs')
      .withIndex('by_environment_version', (q) => q.eq('environment', args.environment))
      .order('desc')
      .take(50);
    return rows.map((row) => ({ ...row, _id: undefined, _creationTime: undefined, id: row.tokenConfigId }));
  },
});

export const tokenConfigById = internalQuery({
  args: { tokenConfigId: v.string() },
  handler: async (ctx, args) => ctx.db.query('tokenConfigs')
    .withIndex('by_config_id', (q) => q.eq('tokenConfigId', args.tokenConfigId)).first(),
});

/** Persist a validated draft. The RPC validation already happened in an action. */
export const saveValidatedConfig = internalMutation({
  args: { config: v.any() },
  handler: async (ctx, args) => {
    const input = args.config;
    const latest = await ctx.db.query('tokenConfigs')
      .withIndex('by_environment_version', (q) => q.eq('environment', input.environment))
      .order('desc').first();
    const now = Date.now();
    const row = {
      ...input,
      configVersion: (latest?.configVersion || 0) + 1,
      status: 'VALIDATED',
      validatedAt: now,
      activatedAt: null,
      activatedBy: null,
      retiredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const id = await ctx.db.insert('tokenConfigs', row);
    return ctx.db.get(id);
  },
});

/**
 * Two-step activation (§7.5). Exactly one configuration may be ACTIVE per
 * environment; the previous one is paused rather than retired so its unresolved
 * deposits and withdrawals stay monitored (§7.6).
 */
export const activateConfig = internalMutation({
  args: { tokenConfigId: v.string(), adminUserId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('tokenConfigs')
      .withIndex('by_config_id', (q) => q.eq('tokenConfigId', args.tokenConfigId)).first();
    if (!row) chainFail('token-config-not-found');
    assertTokenConfigTransition(row.status, 'ACTIVE');
    const now = Date.now();
    const previous = await activeConfigRow(ctx, row.environment);
    if (previous && previous._id !== row._id) {
      await ctx.db.patch(previous._id, { status: 'PAUSED', updatedAt: now });
    }
    await ctx.db.patch(row._id, { status: 'ACTIVE', activatedAt: now, activatedBy: args.adminUserId, updatedAt: now });
    return { activated: await ctx.db.get(row._id), previous: previous ? await ctx.db.get(previous._id) : null };
  },
});

export const setConfigStatus = internalMutation({
  args: { tokenConfigId: v.string(), status: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('tokenConfigs')
      .withIndex('by_config_id', (q) => q.eq('tokenConfigId', args.tokenConfigId)).first();
    if (!row) chainFail('token-config-not-found');
    assertTokenConfigTransition(row.status, args.status);
    if (args.status === 'RETIRED') {
      // A configuration with unresolved money must keep being monitored.
      const openDeposits = await ctx.db.query('chainDeposits')
        .withIndex('by_config', (q) => q.eq('tokenConfigId', args.tokenConfigId))
        .filter((q) => q.and(q.neq(q.field('status'), 'CREDITED'), q.neq(q.field('status'), 'FAILED'), q.neq(q.field('status'), 'EXPIRED')))
        .first();
      const openWithdrawals = await ctx.db.query('chainWithdrawals')
        .withIndex('by_config', (q) => q.eq('tokenConfigId', args.tokenConfigId))
        .filter((q) => q.and(q.neq(q.field('status'), 'COMPLETED'), q.neq(q.field('status'), 'FAILED'), q.neq(q.field('status'), 'REVERSED')))
        .first();
      if (openDeposits || openWithdrawals) chainFail('token-config-has-unresolved-operations');
    }
    const patch = { status: args.status, updatedAt: Date.now() };
    if (args.status === 'RETIRED') patch.retiredAt = Date.now();
    await ctx.db.patch(row._id, patch);
    return ctx.db.get(row._id);
  },
});

export const recordAudit = internalMutation({
  args: { entry: v.any() },
  handler: async (ctx, args) => {
    await ctx.db.insert('chainAudit', args.entry);
    return { recorded: true };
  },
});

export const auditTail = query({
  args: { serviceSecret: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    assertService(args.serviceSecret);
    const rows = await ctx.db.query('chainAudit').withIndex('by_time').order('desc')
      .take(Math.min(50, Math.max(1, args.limit || 20)));
    return rows.map((row) => ({ ...row, _id: undefined, _creationTime: undefined }));
  },
});

// ── wallet linking ──────────────────────────────────────────────────────────
export const storeChallenge = internalMutation({
  args: { challenge: v.any() },
  handler: async (ctx, args) => {
    const c = args.challenge;
    await ctx.db.insert('walletChallenges', {
      nonce: c.nonce,
      requestId: c.requestId,
      accountId: c.accountId,
      walletAddress: c.walletAddress,
      addressKey: addressKey(c.walletAddress),
      chainId: c.chainId,
      domain: c.domain,
      uri: c.uri,
      message: c.message,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      used: false,
    });
    return { nonce: c.nonce };
  },
});

export const challengeByNonce = internalQuery({
  args: { nonce: v.string() },
  handler: async (ctx, args) => ctx.db.query('walletChallenges')
    .withIndex('by_nonce', (q) => q.eq('nonce', args.nonce)).first(),
});

/**
 * Consume the challenge and link the wallet.
 *
 * §9.7: one game account may link several wallets, and linking never creates a
 * second house or family. A wallet already linked to a different account is
 * rejected instead of being silently moved.
 */
export const completeWalletLink = internalMutation({
  args: {
    nonce: v.string(),
    accountId: v.string(),
    walletAddress: v.string(),
    chainId: v.number(),
    providerType: v.string(),
    sessionTokenHash: v.string(),
    walletIdSeed: v.string(),
  },
  handler: async (ctx, args) => {
    const challenge = await ctx.db.query('walletChallenges')
      .withIndex('by_nonce', (q) => q.eq('nonce', args.nonce)).first();
    if (!challenge) chainFail('wallet-challenge-not-found');
    if (challenge.used) chainFail('wallet-challenge-already-used');
    if (challenge.expiresAt <= Date.now()) chainFail('wallet-challenge-expired');
    if (challenge.accountId !== args.accountId) chainFail('wallet-challenge-account-mismatch');
    if (!sameAddress(challenge.walletAddress, args.walletAddress)) chainFail('wallet-challenge-address-mismatch');
    if (challenge.chainId !== args.chainId) chainFail('wallet-challenge-chain-mismatch');
    await ctx.db.patch(challenge._id, { used: true });

    const key = addressKey(args.walletAddress);
    const now = Date.now();
    let wallet = await ctx.db.query('linkedChainWallets')
      .withIndex('by_address', (q) => q.eq('chainId', args.chainId).eq('addressKey', key)).first();
    if (wallet && wallet.gameAccountId !== args.accountId && wallet.status === 'linked') {
      chainFail('wallet-linked-to-another-account');
    }
    if (wallet) {
      await ctx.db.patch(wallet._id, {
        gameAccountId: args.accountId,
        providerType: args.providerType,
        verifiedAt: now,
        lastUsedAt: now,
        status: 'linked',
      });
    } else {
      const walletId = `cw_${args.walletIdSeed}`;
      const id = await ctx.db.insert('linkedChainWallets', {
        walletId,
        gameAccountId: args.accountId,
        chainFamily: 'evm',
        chainId: args.chainId,
        address: args.walletAddress,
        addressKey: key,
        providerType: args.providerType,
        verifiedAt: now,
        lastUsedAt: now,
        status: 'linked',
      });
      wallet = await ctx.db.get(id);
    }
    wallet = await ctx.db.get(wallet._id);

    await ctx.db.insert('chainSessions', {
      tokenHash: args.sessionTokenHash,
      accountId: args.accountId,
      walletId: wallet.walletId,
      addressKey: key,
      chainId: args.chainId,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      revokedAt: null,
    });
    await ctx.db.insert('chainOutbox', {
      eventId: `evt_link_${wallet.walletId}_${now}`,
      eventType: 'wallet_linked',
      accountId: args.accountId,
      stateRevision: now,
      serverTimestamp: now,
      payload: { walletId: wallet.walletId, address: wallet.address, chainId: args.chainId },
      deliveredAt: null,
    });
    return {
      walletId: wallet.walletId,
      address: wallet.address,
      chainId: wallet.chainId,
      providerType: wallet.providerType,
      verifiedAt: wallet.verifiedAt,
      expiresAt: now + SESSION_TTL_MS,
    };
  },
});

export const linkedWallets = query({
  args: { accountId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args) => {
    await authorize(ctx, args);
    const rows = await ctx.db.query('linkedChainWallets')
      .withIndex('by_account', (q) => q.eq('gameAccountId', args.accountId)).collect();
    return rows.filter((row) => row.status === 'linked').map((row) => ({
      walletId: row.walletId,
      address: row.address,
      chainId: row.chainId,
      providerType: row.providerType,
      verifiedAt: row.verifiedAt,
      lastUsedAt: row.lastUsedAt,
    }));
  },
});

export const walletByIdInternal = internalQuery({
  args: { walletId: v.string() },
  handler: async (ctx, args) => ctx.db.query('linkedChainWallets')
    .withIndex('by_wallet_id', (q) => q.eq('walletId', args.walletId)).first(),
});

export const sessionByToken = internalQuery({
  args: { accountId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const row = await sessionRow(ctx, args.sessionToken);
    return row && row.accountId === args.accountId ? row : null;
  },
});

export const endSession = mutation({
  args: { accountId: v.string(), sessionToken: v.string() },
  handler: async (ctx, args) => {
    const row = await sessionRow(ctx, args.sessionToken);
    if (row && row.accountId === args.accountId) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { ended: true };
  },
});

// ── deposits ────────────────────────────────────────────────────────────────
export const insertDeposit = internalMutation({
  args: { deposit: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('chainDeposits')
      .withIndex('by_deposit_id', (q) => q.eq('depositId', args.deposit.depositId)).first();
    if (existing) return existing;
    const id = await ctx.db.insert('chainDeposits', args.deposit);
    return ctx.db.get(id);
  },
});

export const depositByIdInternal = internalQuery({
  args: { depositId: v.string() },
  handler: async (ctx, args) => ctx.db.query('chainDeposits')
    .withIndex('by_deposit_id', (q) => q.eq('depositId', args.depositId)).first(),
});

export const openDeposits = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const open = [];
    for (const status of ['SUBMITTED', 'SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'REORGED']) {
      const rows = await ctx.db.query('chainDeposits')
        .withIndex('by_status', (q) => q.eq('status', status)).order('asc').take(args.limit || 25);
      open.push(...rows);
    }
    return open;
  },
});

/**
 * Apply one verification result.
 *
 * Crediting is guarded twice: by the unique `chainId + transactionHash +
 * logIndex` log identity and by the one-credit-per-depositId rule, so a
 * duplicate webhook, a retry and a replayed client call all converge on the
 * same single credit.
 */
export const applyDepositResult = internalMutation({
  args: {
    depositId: v.string(),
    status: v.string(),
    finalityStatus: v.union(v.string(), v.null()),
    transactionHash: v.union(v.string(), v.null()),
    logIndex: v.union(v.number(), v.null()),
    blockNumber: v.union(v.string(), v.null()),
    blockHash: v.union(v.string(), v.null()),
    failureReason: v.union(v.string(), v.null()),
    credit: v.boolean(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('chainDeposits')
      .withIndex('by_deposit_id', (q) => q.eq('depositId', args.depositId)).first();
    if (!row) chainFail('deposit-not-found');
    if (row.status === 'CREDITED') return { deposit: row, credited: false, duplicate: true };

    const now = Date.now();
    if (args.credit) {
      const identity = logIdentity({
        chainId: row.chainId, transactionHash: args.transactionHash, logIndex: args.logIndex,
      });
      const seen = await ctx.db.query('processedChainLogs')
        .withIndex('by_log_id', (q) => q.eq('logId', identity)).first();
      if (seen && seen.depositId && seen.depositId !== row.depositId) chainFail('log-already-credited-elsewhere');
      if (!seen) {
        await ctx.db.insert('processedChainLogs', {
          logId: identity,
          chainId: row.chainId,
          transactionHash: args.transactionHash,
          logIndex: args.logIndex,
          contractAddress: row.depositContractAddress,
          eventName: 'Deposited',
          blockNumber: args.blockNumber || '0',
          blockHash: args.blockHash || '',
          removed: false,
          depositId: row.depositId,
          processedAt: now,
        });
      } else if (!seen.depositId) {
        await ctx.db.patch(seen._id, { depositId: row.depositId, processedAt: now });
      } else {
        return { deposit: row, credited: false, duplicate: true };
      }
    }

    const nextStatus = args.credit ? 'CREDITED' : args.status;
    assertDepositTransition(row.status, nextStatus);
    await ctx.db.patch(row._id, {
      status: nextStatus,
      finalityStatus: args.finalityStatus,
      transactionHash: args.transactionHash ?? row.transactionHash,
      logIndex: args.logIndex ?? row.logIndex,
      blockNumber: args.blockNumber ?? row.blockNumber,
      blockHash: args.blockHash ?? row.blockHash,
      failureReason: args.failureReason,
      creditedAt: args.credit ? now : row.creditedAt,
      updatedAt: now,
    });
    // The state change and its notification are written in the same
    // transaction, so a credit can never exist without a recoverable event.
    await ctx.db.insert('chainOutbox', {
      eventId: `evt_dep_${row.depositId}_${nextStatus}_${now}`,
      eventType: 'deposit_status_changed',
      accountId: row.gameAccountId,
      stateRevision: now,
      serverTimestamp: now,
      payload: {
        depositId: row.depositId,
        status: nextStatus,
        finalityStatus: args.finalityStatus,
        transactionHash: args.transactionHash ?? row.transactionHash,
        expectedGameCoins: row.expectedGameCoins,
        failureReason: args.failureReason,
      },
      deliveredAt: null,
    });
    return { deposit: await ctx.db.get(row._id), credited: args.credit, duplicate: false };
  },
});

export const myDeposits = query({
  args: { accountId: v.string(), sessionToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await authorize(ctx, args);
    const rows = await ctx.db.query('chainDeposits')
      .withIndex('by_account', (q) => q.eq('gameAccountId', args.accountId))
      .order('desc').take(Math.min(50, args.limit || 20));
    return rows.map(publicDeposit);
  },
});

function publicDeposit(row) {
  return {
    depositId: row.depositId,
    status: row.status,
    finalityStatus: row.finalityStatus,
    requiredFinalityTag: row.requiredFinalityTag,
    chainId: row.chainId,
    tokenAddress: row.tokenAddress,
    rawAmount: row.rawAmount,
    tokenDecimals: row.tokenDecimals,
    expectedGameCoins: row.expectedGameCoins,
    transactionHash: row.transactionHash,
    failureReason: row.failureReason,
    quoteExpiresAt: row.quoteExpiresAt,
    creditedAt: row.creditedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── withdrawals ─────────────────────────────────────────────────────────────
export const insertWithdrawal = internalMutation({
  args: { withdrawal: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('chainWithdrawals')
      .withIndex('by_idempotency', (q) => q.eq('idempotencyKey', args.withdrawal.idempotencyKey)).first();
    if (existing) return { withdrawal: existing, duplicate: true };
    const id = await ctx.db.insert('chainWithdrawals', args.withdrawal);
    return { withdrawal: await ctx.db.get(id), duplicate: false };
  },
});

export const withdrawalByIdInternal = internalQuery({
  args: { withdrawalId: v.string() },
  handler: async (ctx, args) => ctx.db.query('chainWithdrawals')
    .withIndex('by_withdrawal_id', (q) => q.eq('withdrawalId', args.withdrawalId)).first(),
});

export const openWithdrawals = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const open = [];
    for (const status of ['QUEUED', 'SUBMITTED', 'SOFT_CONFIRMED', 'SAFE', 'FINALIZED', 'MANUAL_REVIEW']) {
      const rows = await ctx.db.query('chainWithdrawals')
        .withIndex('by_status', (q) => q.eq('status', status)).order('asc').take(args.limit || 25);
      open.push(...rows);
    }
    return open;
  },
});

export const applyWithdrawalResult = internalMutation({
  args: {
    withdrawalId: v.string(),
    status: v.string(),
    finalityStatus: v.union(v.string(), v.null()),
    transactionHash: v.union(v.string(), v.null()),
    blockNumber: v.union(v.string(), v.null()),
    blockHash: v.union(v.string(), v.null()),
    failureCode: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('chainWithdrawals')
      .withIndex('by_withdrawal_id', (q) => q.eq('withdrawalId', args.withdrawalId)).first();
    if (!row) chainFail('withdrawal-not-found');
    if (row.status === args.status && row.transactionHash === args.transactionHash) return row;
    assertWithdrawalTransition(row.status, args.status);
    // A transaction hash is written exactly once. Losing it would let a retry
    // send a second transfer for the same withdrawal.
    if (row.transactionHash && args.transactionHash && row.transactionHash !== args.transactionHash) {
      chainFail('withdrawal-transaction-hash-conflict');
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: args.status,
      finalityStatus: args.finalityStatus,
      transactionHash: args.transactionHash ?? row.transactionHash,
      blockNumber: args.blockNumber ?? row.blockNumber,
      blockHash: args.blockHash ?? row.blockHash,
      failureCode: args.failureCode,
      submittedAt: args.status === 'SUBMITTED' ? (row.submittedAt || now) : row.submittedAt,
      completedAt: args.status === 'COMPLETED' ? now : row.completedAt,
      updatedAt: now,
    });
    await ctx.db.insert('chainOutbox', {
      eventId: `evt_wd_${row.withdrawalId}_${args.status}_${now}`,
      eventType: 'withdrawal_status_changed',
      accountId: row.gameAccountId,
      stateRevision: now,
      serverTimestamp: now,
      payload: {
        withdrawalId: row.withdrawalId,
        status: args.status,
        transactionHash: args.transactionHash ?? row.transactionHash,
        failureCode: args.failureCode,
      },
      deliveredAt: null,
    });
    return ctx.db.get(row._id);
  },
});

export const myWithdrawals = query({
  args: { accountId: v.string(), sessionToken: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await authorize(ctx, args);
    const rows = await ctx.db.query('chainWithdrawals')
      .withIndex('by_account', (q) => q.eq('gameAccountId', args.accountId))
      .order('desc').take(Math.min(50, args.limit || 20));
    return rows.map((row) => ({
      withdrawalId: row.withdrawalId,
      status: row.status,
      finalityStatus: row.finalityStatus,
      chainId: row.chainId,
      walletAddress: row.walletAddress,
      rawAmount: row.rawAmount,
      tokenDecimals: row.tokenDecimals,
      gameCoinAmount: row.gameCoinAmount,
      transactionHash: row.transactionHash,
      failureCode: row.failureCode,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      completedAt: row.completedAt,
    }));
  },
});

// ── ingestion cursor and processed logs ─────────────────────────────────────
export const readCursor = internalQuery({
  args: { cursorId: v.string() },
  handler: async (ctx, args) => ctx.db.query('chainCursors')
    .withIndex('by_cursor_id', (q) => q.eq('cursorId', args.cursorId)).first(),
});

export const writeCursor = internalMutation({
  args: {
    cursorId: v.string(), chainId: v.number(), contractAddress: v.string(),
    lastProcessedBlock: v.string(), lastProcessedBlockHash: v.union(v.string(), v.null()), workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.query('chainCursors')
      .withIndex('by_cursor_id', (q) => q.eq('cursorId', args.cursorId)).first();
    const value = { ...args, updatedAt: Date.now() };
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert('chainCursors', value);
    return { cursorId: args.cursorId, lastProcessedBlock: args.lastProcessedBlock };
  },
});

export const recordProcessedLog = internalMutation({
  args: { log: v.any() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query('processedChainLogs')
      .withIndex('by_log_id', (q) => q.eq('logId', args.log.logId)).first();
    if (existing) {
      if (existing.removed !== args.log.removed) {
        await ctx.db.patch(existing._id, { removed: args.log.removed, processedAt: Date.now() });
      }
      return { duplicate: true };
    }
    await ctx.db.insert('processedChainLogs', { ...args.log, processedAt: Date.now() });
    return { duplicate: false };
  },
});

export const creditedLogIds = internalQuery({
  args: { chainId: v.number(), transactionHash: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db.query('processedChainLogs')
      .withIndex('by_transaction', (q) => q.eq('chainId', args.chainId).eq('transactionHash', args.transactionHash))
      .collect();
    return rows.filter((row) => row.depositId).map((row) => row.logId);
  },
});

// ── outbox ──────────────────────────────────────────────────────────────────
export const myEvents = query({
  args: { accountId: v.string(), sessionToken: v.string(), since: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await authorize(ctx, args);
    const rows = await ctx.db.query('chainOutbox')
      .withIndex('by_account', (q) => q.eq('accountId', args.accountId)
        .gt('serverTimestamp', args.since || 0))
      .order('desc').take(40);
    return rows.map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType,
      accountId: row.accountId,
      stateRevision: row.stateRevision,
      serverTimestamp: row.serverTimestamp,
      sanitizedPayload: row.payload,
    }));
  },
});

export const markDelivered = internalMutation({
  args: { eventIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const eventId of args.eventIds) {
      const row = await ctx.db.query('chainOutbox')
        .withIndex('by_event_id', (q) => q.eq('eventId', eventId)).first();
      if (row && !row.deliveredAt) await ctx.db.patch(row._id, { deliveredAt: Date.now() });
    }
    return { marked: args.eventIds.length };
  },
});

export const pruneChainState = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let removed = 0;
    const challenges = await ctx.db.query('walletChallenges').take(200);
    for (const row of challenges) {
      if (row.expiresAt < now - 60 * 60_000) { await ctx.db.delete(row._id); removed += 1; }
    }
    const sessions = await ctx.db.query('chainSessions').take(200);
    for (const row of sessions) {
      if (row.expiresAt < now - 24 * 60 * 60_000) { await ctx.db.delete(row._id); removed += 1; }
    }
    const events = await ctx.db.query('chainOutbox').take(400);
    for (const row of events) {
      if (row.serverTimestamp < now - 7 * 24 * 60 * 60_000) { await ctx.db.delete(row._id); removed += 1; }
    }
    return { removed };
  },
});
