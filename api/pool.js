import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token';

export const config = { maxDuration: 60 };

const MAX_DEVNET_WITHDRAWAL = 250_000;

function poolKeypair(record) {
  if (!Array.isArray(record?.secretKey) || record.secretKey.length !== 64) {
    throw new Error('Devnet escrow pool key is unavailable');
  }
  const keypair = Keypair.fromSecretKey(Uint8Array.from(record.secretKey));
  if (record.address && keypair.publicKey.toBase58() !== record.address) {
    throw new Error('Devnet escrow pool address does not match its key');
  }
  return keypair;
}

export function parsePoolEnvironment(encoded = process.env.TOKEN_CITY_DEVNET_POOL_B64) {
  if (!encoded) throw new Error('Devnet escrow pool is not configured');
  let vault;
  try {
    vault = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('Devnet escrow pool configuration is invalid');
  }
  if (vault?.status !== 'ready' || vault?.network !== 'devnet' || !vault?.mint || !vault?.pool) {
    throw new Error('Devnet escrow pool configuration is incomplete');
  }
  new PublicKey(vault.mint);
  poolKeypair(vault.pool);
  return vault;
}

export function publicPoolSummary(vault) {
  return {
    status: vault.status,
    network: 'devnet',
    rpcUrl: vault.rpc || 'https://api.devnet.solana.com',
    mint: vault.mint,
    poolWallet: vault.pool.address,
    decimals: Number(vault.decimals ?? 6),
  };
}

async function mintContext(vault) {
  const connection = new Connection(vault.rpc || 'https://api.devnet.solana.com', 'confirmed');
  const mint = new PublicKey(vault.mint);
  const account = await connection.getAccountInfo(mint, 'confirmed');
  if (!account) throw new Error('Configured Devnet mint was not found');
  const programId = account.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID
    : account.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : null;
  if (!programId) throw new Error('Configured mint is not an SPL token');
  const info = await getMint(connection, mint, 'confirmed', programId);
  return { connection, mint, programId, decimals: info.decimals };
}

async function tokenBalance(ctx, address) {
  const owner = new PublicKey(address);
  const ata = await getAssociatedTokenAddress(ctx.mint, owner, false, ctx.programId);
  if (!await ctx.connection.getAccountInfo(ata, 'confirmed')) return 0;
  const amount = await ctx.connection.getTokenAccountBalance(ata, 'confirmed');
  return Number(amount.value.uiAmountString || 0);
}

function transferUnits(amount, decimals) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > MAX_DEVNET_WITHDRAWAL) {
    throw new Error(`Devnet withdrawal must be between 0 and ${MAX_DEVNET_WITHDRAWAL.toLocaleString('en-US')} tokens`);
  }
  const units = Math.round(numeric * (10 ** decimals));
  if (!Number.isSafeInteger(units) || units <= 0) throw new Error('Withdrawal amount is invalid');
  return BigInt(units);
}

async function withdrawFromPool(vault, ctx, destinationAddress, amount) {
  const owner = poolKeypair(vault.pool);
  const destination = new PublicKey(destinationAddress);
  const sourceAta = await getAssociatedTokenAddress(ctx.mint, owner.publicKey, false, ctx.programId);
  const destinationAta = await getAssociatedTokenAddress(ctx.mint, destination, false, ctx.programId);
  if (!await ctx.connection.getAccountInfo(sourceAta, 'confirmed')) throw new Error('The escrow pool has not received any player tokens yet');
  const units = transferUnits(amount, ctx.decimals);
  const sourceBalance = await ctx.connection.getTokenAccountBalance(sourceAta, 'confirmed');
  if (BigInt(sourceBalance.value.amount) < units) throw new Error('The player-funded escrow pool does not contain enough tokens');

  const tx = new Transaction();
  if (!await ctx.connection.getAccountInfo(destinationAta, 'confirmed')) {
    tx.add(createAssociatedTokenAccountInstruction(
      owner.publicKey, destinationAta, destination, ctx.mint, ctx.programId,
    ));
  }
  tx.add(createTransferCheckedInstruction(
    sourceAta, ctx.mint, destinationAta, owner.publicKey, units, ctx.decimals, [], ctx.programId,
  ));
  return sendAndConfirmTransaction(ctx.connection, tx, [owner], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
    maxRetries: 4,
  });
}

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

function bodyOf(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  return {};
}

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('allow', 'GET, POST');
    return json(response, 405, { error: 'Method not allowed' });
  }
  try {
    const vault = parsePoolEnvironment();
    const ctx = await mintContext(vault);
    const summary = publicPoolSummary(vault);
    summary.decimals = ctx.decimals;
    summary.poolBalance = await tokenBalance(ctx, summary.poolWallet);
    if (request.method === 'GET') return json(response, 200, summary);

    const body = bodyOf(request);
    if (body.action !== 'withdraw') throw new Error('Unknown escrow pool operation');
    if (body.network && body.network !== 'devnet') throw new Error('This test pool works only on Devnet');
    if (body.mint && body.mint !== vault.mint) throw new Error('The selected token does not match the Devnet pool token');
    const signature = await withdrawFromPool(vault, ctx, body.destinationAddress, body.amount);
    return json(response, 200, {
      ok: true,
      signature,
      explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      poolWallet: summary.poolWallet,
      poolBalance: await tokenBalance(ctx, summary.poolWallet),
      destinationAddress: new PublicKey(body.destinationAddress).toBase58(),
    });
  } catch (error) {
    const unavailable = /not configured|configuration is/.test(error?.message || '');
    return json(response, unavailable ? 503 : 400, { error: error?.message || 'Devnet escrow pool operation failed' });
  }
}
