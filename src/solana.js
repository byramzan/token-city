import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createMint,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
  mintToChecked,
} from '@solana/spl-token';

export const SOLANA_NETWORKS = Object.freeze({
  devnet: { label: 'Devnet · Test', rpc: 'https://api.devnet.solana.com', explorer: 'devnet' },
  testnet: { label: 'Testnet', rpc: 'https://api.testnet.solana.com', explorer: 'testnet' },
  mainnet: { label: 'Mainnet', rpc: 'https://api.mainnet.solana.com', explorer: 'mainnet-beta' },
});

const connections = new Map();
let localVault = undefined;

export function rpcUrlFor(config = {}) {
  return String(config.rpcUrl || SOLANA_NETWORKS[config.network]?.rpc || SOLANA_NETWORKS.devnet.rpc).trim();
}

export function connectionFor(config = {}) {
  const rpc = rpcUrlFor(config);
  if (!connections.has(rpc)) connections.set(rpc, new Connection(rpc, 'confirmed'));
  return connections.get(rpc);
}

export function isSolanaAddress(value) {
  try { return !!new PublicKey(String(value || '').trim()); } catch { return false; }
}

async function mintContext(config) {
  if (!isSolanaAddress(config?.mint)) throw new Error('Project Token mint address is invalid');
  const connection = connectionFor(config);
  const mint = new PublicKey(config.mint);
  const account = await connection.getAccountInfo(mint, 'confirmed');
  if (!account) throw new Error('Mint account was not found on the selected network');
  const programId = account.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID
    : account.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : null;
  if (!programId) throw new Error('Address is not owned by SPL Token or Token-2022');
  const info = await getMint(connection, mint, 'confirmed', programId);
  return { connection, mint, info, programId };
}

export async function verifyMintConfiguration(config) {
  const ctx = await mintContext(config);
  const treasury = String(config.treasury || '').trim();
  if (!treasury) throw new Error('Escrow pool wallet is required');
  if (!isSolanaAddress(treasury)) throw new Error('Escrow pool wallet address is invalid');
  const treasuryOwner = new PublicKey(treasury);
  const treasuryAta = await getAssociatedTokenAddress(ctx.mint, treasuryOwner, false, ctx.programId);
  const treasuryAccount = await ctx.connection.getAccountInfo(treasuryAta, 'confirmed');
  const treasuryBalance = treasuryAccount
    ? Number((await ctx.connection.getTokenAccountBalance(treasuryAta, 'confirmed')).value.uiAmountString || 0)
    : 0;
  return {
    mint: ctx.mint.toBase58(),
    decimals: ctx.info.decimals,
    supply: Number(ctx.info.supply) / (10 ** ctx.info.decimals),
    tokenProgram: ctx.programId.equals(TOKEN_2022_PROGRAM_ID) ? 'token-2022' : 'spl-token',
    mintAuthority: ctx.info.mintAuthority?.toBase58() || null,
    freezeAuthority: ctx.info.freezeAuthority?.toBase58() || null,
    treasury: treasuryOwner.toBase58(),
    treasuryBalance,
  };
}

export async function fetchTokenBalance(config, ownerAddress) {
  if (!isSolanaAddress(ownerAddress) || !config?.mint) return 0;
  const ctx = await mintContext(config);
  const owner = new PublicKey(ownerAddress);
  const ata = await getAssociatedTokenAddress(ctx.mint, owner, false, ctx.programId);
  const account = await ctx.connection.getAccountInfo(ata, 'confirmed');
  if (!account) return 0;
  const balance = await ctx.connection.getTokenAccountBalance(ata, 'confirmed');
  return Number(balance.value.uiAmountString || 0);
}

function baseUnits(amount, decimals) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('Token amount must be positive');
  return BigInt(Math.round(numeric * (10 ** decimals)));
}

async function addTransfer(tx, { connection, mint, programId, decimals, payer, owner, destination, amount }) {
  const sourceAta = await getAssociatedTokenAddress(mint, owner, false, programId);
  const destinationAta = await getAssociatedTokenAddress(mint, destination, false, programId);
  if (!await connection.getAccountInfo(sourceAta, 'confirmed')) throw new Error('Source wallet has no Project Token account');
  if (!await connection.getAccountInfo(destinationAta, 'confirmed')) {
    tx.add(createAssociatedTokenAccountInstruction(payer, destinationAta, destination, mint, programId));
  }
  tx.add(createTransferCheckedInstruction(
    sourceAta, mint, destinationAta, owner, baseUnits(amount, decimals), decimals, [], programId,
  ));
}

async function confirmFreshTransaction(connection, signature, latest) {
  try {
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    if (confirmation?.value?.err) throw new Error('The token transfer was rejected by Solana');
    return;
  } catch (error) {
    // A websocket/RPC confirmation can time out after the transaction was
    // already accepted. Check its durable status before telling the player to
    // retry, otherwise a retry could pay twice.
    const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
    const value = status?.value;
    if (value && !value.err && ['confirmed', 'finalized'].includes(value.confirmationStatus)) return;
    if (value?.err) throw new Error('The token transfer was rejected by Solana', { cause: error });
    throw error;
  }
}

export async function depositProjectTokens({ config, walletAddress, adapter, amount }) {
  if (!adapter) throw new Error('Reconnect this wallet before signing');
  if (!isSolanaAddress(config?.treasury)) throw new Error('Token escrow pool is not configured');
  const ctx = await mintContext(config);
  const owner = new PublicKey(walletAddress);
  const treasury = new PublicKey(config.treasury);
  const tx = new Transaction();
  await addTransfer(tx, {
    ...ctx,
    decimals: ctx.info.decimals,
    payer: owner,
    owner,
    destination: treasury,
    amount,
  });
  const latest = await ctx.connection.getLatestBlockhash('confirmed');
  tx.feePayer = owner;
  tx.recentBlockhash = latest.blockhash;
  let signature;
  if (adapter.signTransaction) {
    const signed = await adapter.signTransaction(tx);
    signature = await ctx.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
  } else if (adapter.signAndSendTransaction) {
    const result = await adapter.signAndSendTransaction(tx);
    signature = result?.signature || result;
  } else {
    throw new Error('This wallet cannot sign Solana transactions');
  }
  await confirmFreshTransaction(ctx.connection, signature, latest);
  return { signature, explorer: explorerTransactionUrl(signature, config.network) };
}

export function explorerTransactionUrl(signature, network = 'devnet') {
  const cluster = SOLANA_NETWORKS[network]?.explorer || 'devnet';
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster}`;
}

export async function loadLocalTestWallets() {
  if (!import.meta.env.DEV) return [];
  if (localVault !== undefined) return localVault?.wallets || [];
  try {
    const response = await fetch('/__local-test-wallets', { cache: 'no-store' });
    localVault = response.ok ? await response.json() : null;
  } catch {
    localVault = null;
  }
  return localVault?.wallets || [];
}

/** Local shortcut for development only. Production testing uses the exported
 * key files imported into Phantom, so player keys never reach the website. */
export async function loadTestWallets() {
  const local = await loadLocalTestWallets();
  return local.map((wallet) => ({ ...wallet, source: 'local' }));
}

export async function connectLocalTestWallet(walletId) {
  const wallets = await loadLocalTestWallets();
  const record = wallets.find((wallet) => wallet.id === walletId);
  if (!record?.secretKey) throw new Error('Local test wallet is unavailable');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(record.secretKey));
  return {
    address: keypair.publicKey.toBase58(),
    adapter: {
      publicKey: keypair.publicKey,
      connect: async () => ({ publicKey: keypair.publicKey }),
      signTransaction: async (transaction) => { transaction.partialSign(keypair); return transaction; },
    },
    record,
  };
}

export async function connectTestWallet(walletId) {
  return connectLocalTestWallet(walletId);
}

export async function localTestConfig() {
  await loadLocalTestWallets();
  if (!localVault || localVault.status !== 'ready' || !localVault.mint) return null;
  return {
    network: localVault.network,
    mint: localVault.mint,
    treasury: localVault.pool?.address || localVault.treasury?.address,
    decimals: localVault.decimals,
  };
}

export async function testWalletConfig() {
  return localTestConfig();
}

export async function depositTestWalletTokens({ config, walletAddress, adapter, amount }) {
  if (adapter) return depositProjectTokens({ config, walletAddress, adapter, amount });
  if (import.meta.env.DEV) {
    const wallets = await loadLocalTestWallets();
    const record = wallets.find((wallet) => wallet.address === walletAddress);
    if (record) {
      const local = await connectLocalTestWallet(record.id);
      return depositProjectTokens({ config, walletAddress, adapter: local.adapter, amount });
    }
  }
  throw new Error('Import this Devnet wallet into Phantom and reconnect it before depositing');
}

/** Complete the one-time local Devnet vault setup in the browser. This exists
 * only in Vite development: the private file and write endpoint are never
 * included in the production build or exposed by a deployed static site. */
export async function completeLocalTestWalletSetup() {
  if (!import.meta.env.DEV) throw new Error('Local wallet setup is available only in development');
  await loadLocalTestWallets();
  if (!localVault?.authority?.secretKey || !localVault?.treasury?.secretKey || localVault.wallets?.length !== 3) {
    throw new Error('Local test wallet draft is missing');
  }
  if (localVault.status === 'ready' && localVault.mint) return localTestConfig();

  const connection = connectionFor({ network: 'devnet', rpcUrl: localVault.rpc });
  const authority = Keypair.fromSecretKey(Uint8Array.from(localVault.authority.secretKey));
  const treasury = Keypair.fromSecretKey(Uint8Array.from(localVault.treasury.secretKey));
  const wallets = localVault.wallets.map((record) => ({
    record,
    keypair: Keypair.fromSecretKey(Uint8Array.from(record.secretKey)),
  }));
  const authorityBalance = await connection.getBalance(authority.publicKey, 'confirmed');
  if (authorityBalance < 0.55 * LAMPORTS_PER_SOL) {
    throw new Error(`Authority has only ${(authorityBalance / LAMPORTS_PER_SOL).toFixed(3)} Devnet SOL; at least 0.55 is required`);
  }

  for (const recipient of [treasury, ...wallets.map((wallet) => wallet.keypair)]) {
    if (await connection.getBalance(recipient.publicKey, 'confirmed') >= 0.025 * LAMPORTS_PER_SOL) continue;
    const transaction = new Transaction().add(SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 0.05 * LAMPORTS_PER_SOL,
    }));
    await sendAndConfirmTransaction(connection, transaction, [authority], {
      commitment: 'confirmed', preflightCommitment: 'confirmed', maxRetries: 4,
    });
  }

  const decimals = Number(localVault.decimals ?? 6);
  const mint = await createMint(connection, authority, authority.publicKey, null, decimals);
  const treasuryAta = await createAssociatedTokenAccount(connection, authority, mint, treasury.publicKey);
  await mintToChecked(
    connection, authority, mint, treasuryAta, authority,
    5_000_000n * (10n ** BigInt(decimals)), decimals,
  );
  for (const wallet of wallets) {
    const ata = await createAssociatedTokenAccount(connection, authority, mint, wallet.keypair.publicKey);
    await mintToChecked(
      connection, authority, mint, ata, authority,
      250_000n * (10n ** BigInt(decimals)), decimals,
    );
    wallet.record.tokenBalance = 250_000;
  }

  localVault.status = 'ready';
  localVault.mint = mint.toBase58();
  localVault.decimals = decimals;
  localVault.treasury.tokenBalance = 5_000_000;
  const response = await fetch('/__local-test-wallets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(localVault),
  });
  if (!response.ok) throw new Error('The local Devnet vault could not be saved');
  return localTestConfig();
}

export async function payoutLocalTestTokens({ config, destinationAddress, amount }) {
  await loadLocalTestWallets();
  const poolRecord = localVault?.pool || localVault?.treasury;
  if (!poolRecord?.secretKey || config.network === 'mainnet') {
    throw new Error('Local Devnet escrow pool is unavailable');
  }
  const ctx = await mintContext(config);
  const treasury = Keypair.fromSecretKey(Uint8Array.from(poolRecord.secretKey));
  if (treasury.publicKey.toBase58() !== config.treasury) throw new Error('Devnet escrow pool does not match configuration');
  const destination = new PublicKey(destinationAddress);
  const tx = new Transaction();
  await addTransfer(tx, {
    ...ctx,
    decimals: ctx.info.decimals,
    payer: treasury.publicKey,
    owner: treasury.publicKey,
    destination,
    amount,
  });
  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [treasury], {
    commitment: 'confirmed', preflightCommitment: 'confirmed', maxRetries: 3,
  });
  return { signature, explorer: explorerTransactionUrl(signature, config.network) };
}

export async function payoutTestWalletTokens({ config, destinationAddress, amount }) {
  return payoutLocalTestTokens({ config, destinationAddress, amount });
}

export async function fetchPoolConfiguration(network = 'devnet') {
  if (network !== 'devnet') return null;
  try {
    const response = await fetch('/api/pool', { cache: 'no-store' });
    const type = response.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await response.json() : {};
    if (!response.ok || !payload.mint || !payload.poolWallet) throw new Error(payload.error || 'Pool configuration is unavailable');
    return {
      network: 'devnet',
      rpcUrl: payload.rpcUrl,
      mint: payload.mint,
      treasury: payload.poolWallet,
      decimals: payload.decimals,
      poolBalance: payload.poolBalance,
    };
  } catch {
    if (import.meta.env.DEV) return localTestConfig();
    return null;
  }
}

export async function requestDevnetPoolPayout({ config, destinationAddress, amount, quoteId, accountId }) {
  const response = await fetch('/api/pool', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'withdraw',
      network: 'devnet',
      mint: config.mint,
      destinationAddress,
      amount,
      quoteId,
      accountId,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.signature) throw new Error(payload.error || 'Devnet escrow pool payout failed');
  return payload;
}

export async function requestMainnetPayout({ config, destinationAddress, amount, quoteId, accountId }) {
  if (!config.treasuryApi) throw new Error('Mainnet escrow payout API is not configured');
  const response = await fetch(config.treasuryApi, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ destinationAddress, amount, quoteId, accountId, network: config.network, mint: config.mint }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.signature) throw new Error(payload.error || 'Mainnet escrow payout failed');
  return payload;
}
