import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createAssociatedTokenAccount, createMint, mintToChecked } from '@solana/spl-token';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.token-city-solana.local.json');
const rpc = process.env.SOLANA_DEVNET_RPC || 'https://api.devnet.solana.com';
const connection = new Connection(rpc, 'confirmed');
const decimals = 6;

const secretOf = (keypair) => [...keypair.secretKey];
const restore = (secretKey) => Keypair.fromSecretKey(Uint8Array.from(secretKey));

async function readDraft() {
  try { return JSON.parse(await readFile(target, 'utf8')); } catch { return null; }
}

async function persist(output) {
  await writeFile(target, JSON.stringify(output, null, 2), { mode: 0o600 });
  await chmod(target, 0o600);
}

let output = await readDraft();
if (!output) {
  const authority = Keypair.generate();
  const treasury = Keypair.generate();
  output = {
    generatedAt: new Date().toISOString(),
    status: 'needs-funding',
    network: 'devnet',
    rpc,
    mint: '',
    decimals,
    authority: { address: authority.publicKey.toBase58(), secretKey: secretOf(authority) },
    treasury: { address: treasury.publicKey.toBase58(), secretKey: secretOf(treasury) },
    wallets: Array.from({ length: 3 }, (_, index) => {
      const keypair = Keypair.generate();
      return {
        id: `test-wallet-${index + 1}`,
        name: `Test Wallet ${index + 1}`,
        address: keypair.publicKey.toBase58(),
        tokenBalance: 0,
        secretKey: secretOf(keypair),
      };
    }),
  };
  await persist(output);
}

const authority = restore(output.authority.secretKey);
const treasury = restore(output.treasury.secretKey);
const wallets = output.wallets.map((wallet) => ({ ...wallet, keypair: restore(wallet.secretKey) }));

if (output.status === 'ready' && output.mint) {
  console.log(JSON.stringify({
    status: output.status,
    network: output.network,
    mint: output.mint,
    treasury: output.treasury.address,
    wallets: output.wallets.map(({ id, name, address, tokenBalance }) => ({ id, name, address, tokenBalance })),
    localFile: target,
  }, null, 2));
  process.exit(0);
}

async function tryFaucet() {
  const current = await connection.getBalance(authority.publicKey, 'confirmed');
  if (current >= 0.55 * LAMPORTS_PER_SOL) return true;
  let lastError;
  for (const amount of [1, 0.5, 0.2]) {
    try {
      const signature = await connection.requestAirdrop(authority.publicKey, amount * LAMPORTS_PER_SOL);
      const latest = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
      if (await connection.getBalance(authority.publicKey, 'confirmed') >= 0.55 * LAMPORTS_PER_SOL) return true;
    } catch (error) {
      lastError = error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1600));
    }
  }
  output.status = 'needs-funding';
  await persist(output);
  console.error(JSON.stringify({
    status: output.status,
    message: 'Devnet faucet is rate-limited. Fund the authority address at https://faucet.solana.com and run this command again.',
    authority: output.authority.address,
    requiredSol: 0.55,
    error: lastError?.message || 'faucet unavailable',
    localFile: target,
  }, null, 2));
  return false;
}

if (!await tryFaucet()) process.exit(2);

const recipients = [treasury, ...wallets.map((wallet) => wallet.keypair)];
for (const recipient of recipients) {
  if (await connection.getBalance(recipient.publicKey, 'confirmed') >= 0.025 * LAMPORTS_PER_SOL) continue;
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: authority.publicKey,
    toPubkey: recipient.publicKey,
    lamports: 0.05 * LAMPORTS_PER_SOL,
  }));
  await sendAndConfirmTransaction(connection, tx, [authority], { commitment: 'confirmed' });
}

const mint = await createMint(connection, authority, authority.publicKey, null, decimals);
const treasuryAta = await createAssociatedTokenAccount(connection, authority, mint, treasury.publicKey);
await mintToChecked(connection, authority, mint, treasuryAta, authority, 5_000_000n * (10n ** BigInt(decimals)), decimals);

for (const wallet of wallets) {
  const ata = await createAssociatedTokenAccount(connection, authority, mint, wallet.keypair.publicKey);
  await mintToChecked(connection, authority, mint, ata, authority, 250_000n * (10n ** BigInt(decimals)), decimals);
}

output.status = 'ready';
output.mint = mint.toBase58();
output.treasury.tokenBalance = 5_000_000;
for (const wallet of output.wallets) wallet.tokenBalance = 250_000;
await persist(output);

console.log(JSON.stringify({
  status: output.status,
  network: output.network,
  mint: output.mint,
  treasury: output.treasury.address,
  wallets: output.wallets.map(({ id, name, address, tokenBalance }) => ({ id, name, address, tokenBalance })),
  localFile: target,
}, null, 2));
