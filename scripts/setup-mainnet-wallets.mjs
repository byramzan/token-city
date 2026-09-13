// Create the two Robinhood Chain MAINNET (4663) wallets the launch needs:
//
//   node scripts/setup-mainnet-wallets.mjs            # create (once) + show status/balances
//   node scripts/setup-mainnet-wallets.mjs status     # show addresses + live ETH balances
//
//   1) deployer  — deploys the vault once and becomes its admin (pays gas).
//   2) signer    — the withdrawal signer the backend uses to pay out withdrawals.
//                  It is deliberately NOT the admin: the key the backend holds
//                  can move approved withdrawals and nothing else.
//
// Keys are written only to the gitignored wallet-access/ folder at mode 0600.
// They are never printed in full after creation, never committed and never sent
// to the browser. Gas is paid in ETH on Robinhood mainnet — fund both addresses.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, defineChain, http, formatEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { networkByType } from '../server/chain/networks.js';

const NETWORK = networkByType('mainnet');
const FILE = resolve(process.cwd(), 'wallet-access/robinhood-mainnet.local.json');
const RPC = process.env.RHC_RPC_HTTP_URL_MAINNET || NETWORK.publicRpcUrl;

const chain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.networkName,
  nativeCurrency: { ...NETWORK.nativeCurrency },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: NETWORK.explorerBaseUrl } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

function read() {
  if (!existsSync(FILE)) return null;
  return JSON.parse(readFileSync(FILE, 'utf8'));
}

function write(data) {
  mkdirSync(resolve(process.cwd(), 'wallet-access'), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(FILE, 0o600);
}

function make(id, name, role) {
  const privateKey = generatePrivateKey();
  return { id, name, role, privateKey, address: privateKeyToAccount(privateKey).address };
}

function create() {
  return {
    network: 'robinhood-mainnet',
    chainId: NETWORK.chainId,
    rpc: RPC,
    createdAt: new Date().toISOString(),
    status: 'draft',
    deployer: make('deployer', 'Vault deployer / admin', 'authority'),
    signer: make('signer', 'Withdrawal signer', 'signer'),
  };
}

async function assertChain() {
  const reported = await publicClient.getChainId();
  if (reported !== NETWORK.chainId) {
    throw new Error(`RPC reports chain id ${reported}, expected ${NETWORK.chainId} (mainnet). Refusing to continue.`);
  }
}

async function status(data) {
  await assertChain();
  console.log(`\n${NETWORK.networkName} · chain id ${NETWORK.chainId}\nRPC ${RPC}\n`);
  for (const record of [data.deployer, data.signer]) {
    const balance = await publicClient.getBalance({ address: record.address }).catch(() => 0n);
    console.log(`  ${record.role.padEnd(10)} ${record.name}`);
    console.log(`    address  ${record.address}`);
    console.log(`    balance  ${formatEther(balance)} ETH`);
    console.log(`    explorer ${NETWORK.explorerBaseUrl}/address/${record.address}\n`);
  }
  console.log('Fund both addresses with a small amount of ETH on Robinhood mainnet.');
  console.log('  · deployer — one-time gas to deploy the vault');
  console.log('  · signer   — ongoing gas to pay out withdrawals\n');
  console.log(`Keys are stored (mode 0600, gitignored) in:\n  ${FILE}\n`);
}

const command = process.argv[2] || 'create';
let data = read();
if (!data) {
  data = create();
  write(data);
  console.log(`\nCreated two mainnet wallets in ${FILE} (mode 0600, gitignored).`);
  console.log('These are REAL mainnet keys. Never commit, upload or paste them into the game.');
} else {
  console.log(`\nUsing existing wallets in ${FILE} (not regenerating).`);
}

try {
  await status(data);
} catch (error) {
  console.error(`\n${error.shortMessage || error.message}`);
  process.exitCode = 1;
}
