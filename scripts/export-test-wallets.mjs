import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vaultPath = resolve(root, '.token-city-solana.local.json');
const outputDir = resolve(root, 'wallet-access');
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes) {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let leading = 0;
  while (leading < bytes.length && bytes[leading] === 0) leading++;
  return '1'.repeat(leading) + digits.reverse().map((digit) => alphabet[digit]).join('');
}

const vault = JSON.parse(await readFile(vaultPath, 'utf8'));
if (vault.status !== 'ready' || vault.network !== 'devnet' || vault.wallets?.length !== 3) {
  throw new Error('The ready Devnet wallet vault was not found');
}

await mkdir(outputDir, { recursive: true, mode: 0o700 });
const publicRows = [];
for (const wallet of vault.wallets) {
  const keypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
  if (keypair.publicKey.toBase58() !== wallet.address) throw new Error(`${wallet.name} key mismatch`);
  const target = resolve(outputDir, `${wallet.id}.json`);
  const payload = {
    warning: 'DEVNET ONLY. Anyone with this file controls this disposable test wallet.',
    network: 'devnet',
    rpcUrl: vault.rpc,
    tokenMint: vault.mint,
    id: wallet.id,
    name: wallet.name,
    address: wallet.address,
    privateKeyBase58: base58(wallet.secretKey),
    solanaCliSecretKey: wallet.secretKey,
  };
  await writeFile(target, JSON.stringify(payload, null, 2), { mode: 0o600 });
  await chmod(target, 0o600);
  publicRows.push(`${wallet.name}: ${wallet.address}`);
}

const readme = [
  'TOKEN CITY — DEVNET TEST WALLETS',
  '',
  'These wallets are disposable and must never be used on Solana Mainnet.',
  'Each JSON file contains both a Base58 private key for wallet import and a Solana CLI key array.',
  'Do not upload this folder or send it to anyone you do not trust.',
  '',
  `Token mint: ${vault.mint}`,
  `RPC: ${vault.rpc}`,
  '',
  ...publicRows,
  '',
].join('\n');
await writeFile(resolve(outputDir, 'README.txt'), readme, { mode: 0o600 });
await chmod(resolve(outputDir, 'README.txt'), 0o600);

console.log(JSON.stringify({ outputDir, files: [...vault.wallets.map((wallet) => `${wallet.id}.json`), 'README.txt'] }, null, 2));
