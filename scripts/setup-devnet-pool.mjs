import { chmod, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vaultPath = resolve(root, '.token-city-solana.local.json');
const poolPath = resolve(root, '.token-city-pool.local.json');
const vault = JSON.parse(await readFile(vaultPath, 'utf8'));
if (vault.status !== 'ready' || vault.network !== 'devnet' || !vault.mint) {
  throw new Error('Run npm run setup:test-wallets first');
}

if (!vault.pool?.secretKey) {
  const pool = Keypair.generate();
  vault.pool = { address: pool.publicKey.toBase58(), secretKey: [...pool.secretKey], tokenBalance: 0 };
}
const pool = Keypair.fromSecretKey(Uint8Array.from(vault.pool.secretKey));
const connection = new Connection(vault.rpc || 'https://api.devnet.solana.com', 'confirmed');
const current = await connection.getBalance(pool.publicKey, 'confirmed');
if (current < 0.015 * LAMPORTS_PER_SOL) {
  const candidates = [vault.authority, vault.treasury].filter((entry) => entry?.secretKey);
  let funded = false;
  for (const record of candidates) {
    const payer = Keypair.fromSecretKey(Uint8Array.from(record.secretKey));
    if (await connection.getBalance(payer.publicKey, 'confirmed') < 0.03 * LAMPORTS_PER_SOL) continue;
    const tx = new Transaction().add(SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: pool.publicKey,
      lamports: 0.02 * LAMPORTS_PER_SOL,
    }));
    await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed', maxRetries: 4 });
    funded = true;
    break;
  }
  if (!funded) throw new Error(`Fund the Devnet pool with 0.02 SOL: ${pool.publicKey.toBase58()}`);
}

await writeFile(vaultPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
await chmod(vaultPath, 0o600);
const poolVault = {
  status: 'ready',
  network: 'devnet',
  rpc: vault.rpc || 'https://api.devnet.solana.com',
  mint: vault.mint,
  decimals: vault.decimals,
  pool: vault.pool,
};
await writeFile(poolPath, JSON.stringify(poolVault, null, 2), { mode: 0o600 });
await chmod(poolPath, 0o600);
console.log(JSON.stringify({
  status: 'ready',
  network: 'devnet',
  mint: vault.mint,
  poolWallet: vault.pool.address,
  poolTokenBalance: 0,
  localFile: poolPath,
}, null, 2));
