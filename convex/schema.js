import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
  households: defineTable({
    householdId: v.string(), accountId: v.string(), accessKey: v.string(),
    walletAddress: v.optional(v.string()), state: v.any(), updatedAt: v.number(),
  }).index('by_household', ['householdId']).index('by_account', ['accountId']),
  familyAnalytics: defineTable({
    eventId: v.string(), eventType: v.string(), at: v.number(), cohort: v.number(), data: v.any(),
  }).index('by_event', ['eventId']).index('by_type', ['eventType', 'at']),
  householdOperations: defineTable({
    eventId: v.string(), householdId: v.string(), kind: v.string(), at: v.number(), result: v.any(),
  }).index('by_event', ['eventId']).index('by_household', ['householdId', 'at']),
  houses: defineTable({
    houseId: v.string(),
    plotIndex: v.number(),
    lowerName: v.string(),
    version: v.number(),
    updatedAt: v.number(),
    originClientId: v.string(),
    document: v.any(),
  })
    .index('by_house_id', ['houseId'])
    .index('by_plot', ['plotIndex'])
    .index('by_name', ['lowerName']),
  trades: defineTable({
    purchaseKey: v.string(),
    buyerId: v.string(),
    sellerId: v.string(),
    houseId: v.string(),
    productId: v.string(),
    gross: v.number(),
    fee: v.number(),
    net: v.number(),
    createdAt: v.number(),
  })
    .index('by_purchase_key', ['purchaseKey'])
    .index('by_seller', ['sellerId', 'createdAt']),
  businessOperations: defineTable({
    operationId: v.string(),
    houseId: v.string(),
    accountId: v.string(),
    action: v.string(),
    createdAt: v.number(),
  })
    .index('by_operation_id', ['operationId'])
    .index('by_house', ['houseId', 'createdAt']),
  paymentSessions: defineTable({
    sessionId: v.string(),
    clientId: v.string(),
    accountId: v.string(),
    walletAddress: v.string(),
    quoteId: v.string(),
    coins: v.number(),
    tokens: v.number(),
    status: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    expiresAt: v.number(),
    signature: v.optional(v.string()),
    closeReason: v.optional(v.string()),
  })
    .index('by_session_id', ['sessionId'])
    .index('by_account', ['accountId', 'createdAt']),

  // ── Robinhood Chain (task8 §18) ───────────────────────────────────────────
  // Every row is chain aware. Historical Solana records keep their own
  // chainFamily and are never reinterpreted as EVM data.
  tokenConfigs: defineTable({
    tokenConfigId: v.string(),
    environment: v.string(),          // 'testnet' | 'mainnet'
    networkId: v.string(),
    chainId: v.number(),
    contractAddress: v.string(),      // EIP-55 checksum form, for display
    addressKey: v.string(),           // lowercase, for uniqueness comparison
    name: v.string(),
    symbol: v.string(),
    decimals: v.number(),
    totalSupplyAtValidation: v.string(),
    depositContractAddress: v.string(),
    vaultAddress: v.string(),
    monitoringStartBlock: v.union(v.number(), v.null()),
    configVersion: v.number(),
    status: v.string(),               // DRAFT|VALIDATED|ACTIVE|PAUSED|RETIRED
    conversionRuleVersion: v.string(),
    activationNote: v.string(),
    warnings: v.array(v.string()),
    validatedAt: v.union(v.number(), v.null()),
    activatedAt: v.union(v.number(), v.null()),
    activatedBy: v.union(v.string(), v.null()),
    retiredAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_config_id', ['tokenConfigId'])
    .index('by_environment_status', ['environment', 'status'])
    .index('by_environment_version', ['environment', 'configVersion']),
  chainAudit: defineTable({
    auditId: v.string(),
    adminUserId: v.string(),
    action: v.string(),
    previousConfiguration: v.any(),
    newConfiguration: v.any(),
    serverTimestamp: v.number(),
    requestId: v.string(),
    sourceIpHash: v.string(),
    result: v.string(),
    failureReason: v.union(v.string(), v.null()),
  })
    .index('by_audit_id', ['auditId'])
    .index('by_time', ['serverTimestamp']),
  walletChallenges: defineTable({
    nonce: v.string(),
    requestId: v.string(),
    accountId: v.string(),
    walletAddress: v.string(),
    addressKey: v.string(),
    chainId: v.number(),
    domain: v.string(),
    uri: v.string(),
    message: v.string(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    used: v.boolean(),
  }).index('by_nonce', ['nonce']),
  linkedChainWallets: defineTable({
    walletId: v.string(),
    gameAccountId: v.string(),
    chainFamily: v.string(),
    chainId: v.number(),
    address: v.string(),
    addressKey: v.string(),
    providerType: v.string(),
    verifiedAt: v.number(),
    lastUsedAt: v.number(),
    status: v.string(),               // linked | revoked
  })
    .index('by_wallet_id', ['walletId'])
    .index('by_account', ['gameAccountId'])
    .index('by_address', ['chainId', 'addressKey']),
  chainSessions: defineTable({
    tokenHash: v.string(),
    accountId: v.string(),
    walletId: v.string(),
    addressKey: v.string(),
    chainId: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
  })
    .index('by_token_hash', ['tokenHash'])
    .index('by_account', ['accountId']),
  chainDeposits: defineTable({
    depositId: v.string(),
    depositIdHash: v.string(),
    gameAccountId: v.string(),
    walletId: v.string(),
    walletAddress: v.string(),
    chainId: v.number(),
    tokenConfigId: v.string(),
    tokenConfigVersion: v.number(),
    tokenAddress: v.string(),
    depositContractAddress: v.string(),
    vaultAddress: v.string(),
    rawAmount: v.string(),
    tokenDecimals: v.number(),
    expectedGameCoins: v.number(),
    conversionRuleVersion: v.string(),
    transactionHash: v.union(v.string(), v.null()),
    logIndex: v.union(v.number(), v.null()),
    blockNumber: v.union(v.string(), v.null()),
    blockHash: v.union(v.string(), v.null()),
    finalityStatus: v.union(v.string(), v.null()),
    requiredFinalityTag: v.string(),
    status: v.string(),
    failureReason: v.union(v.string(), v.null()),
    quoteExpiresAt: v.number(),
    creditedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_deposit_id', ['depositId'])
    .index('by_account', ['gameAccountId', 'createdAt'])
    .index('by_status', ['status', 'updatedAt'])
    .index('by_config', ['tokenConfigId', 'status']),
  chainWithdrawals: defineTable({
    withdrawalId: v.string(),
    idempotencyKey: v.string(),
    gameAccountId: v.string(),
    walletId: v.string(),
    walletAddress: v.string(),
    chainId: v.number(),
    tokenConfigId: v.string(),
    tokenConfigVersion: v.number(),
    tokenAddress: v.string(),
    vaultAddress: v.string(),
    rawAmount: v.string(),
    tokenDecimals: v.number(),
    gameCoinAmount: v.number(),
    conversionRuleVersion: v.string(),
    transactionHash: v.union(v.string(), v.null()),
    blockNumber: v.union(v.string(), v.null()),
    blockHash: v.union(v.string(), v.null()),
    finalityStatus: v.union(v.string(), v.null()),
    status: v.string(),
    failureCode: v.union(v.string(), v.null()),
    quoteExpiresAt: v.number(),
    createdAt: v.number(),
    submittedAt: v.union(v.number(), v.null()),
    completedAt: v.union(v.number(), v.null()),
    updatedAt: v.number(),
  })
    .index('by_withdrawal_id', ['withdrawalId'])
    .index('by_idempotency', ['idempotencyKey'])
    .index('by_account', ['gameAccountId', 'createdAt'])
    .index('by_status', ['status', 'updatedAt'])
    .index('by_config', ['tokenConfigId', 'status']),
  processedChainLogs: defineTable({
    logId: v.string(),                // chainId:transactionHash:logIndex
    chainId: v.number(),
    transactionHash: v.string(),
    logIndex: v.number(),
    contractAddress: v.string(),
    eventName: v.string(),
    blockNumber: v.string(),
    blockHash: v.string(),
    removed: v.boolean(),
    depositId: v.union(v.string(), v.null()),
    processedAt: v.number(),
  })
    .index('by_log_id', ['logId'])
    .index('by_transaction', ['chainId', 'transactionHash'])
    .index('by_block', ['chainId', 'blockNumber']),
  chainCursors: defineTable({
    cursorId: v.string(),             // chainId:contractAddressKey
    chainId: v.number(),
    contractAddress: v.string(),
    lastProcessedBlock: v.string(),
    lastProcessedBlockHash: v.union(v.string(), v.null()),
    workerId: v.string(),
    updatedAt: v.number(),
  }).index('by_cursor_id', ['cursorId']),
  chainOutbox: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    accountId: v.string(),
    stateRevision: v.number(),
    serverTimestamp: v.number(),
    payload: v.any(),
    deliveredAt: v.union(v.number(), v.null()),
  })
    .index('by_event_id', ['eventId'])
    .index('by_account', ['accountId', 'serverTimestamp']),
  // Operational site-wide flags (singleton keyed by flagId). Used by the admin
  // kill switch that can black out the whole site for every visitor.
  siteFlags: defineTable({
    flagId: v.string(),               // e.g. 'blackout'
    enabled: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.union(v.string(), v.null()),
  }).index('by_flag_id', ['flagId']),
});
