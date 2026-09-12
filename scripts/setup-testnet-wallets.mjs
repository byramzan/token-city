// Robinhood Chain Testnet (46630) test wallets and contracts.
//
//   node scripts/setup-testnet-wallets.mjs            # create wallets, show status
//   node scripts/setup-testnet-wallets.mjs status
//   node scripts/setup-testnet-wallets.mjs fund       # deployer -> player wallets (ETH for gas)
//   node scripts/setup-testnet-wallets.mjs deploy     # test ERC-20 + vault, mint to players
//
// Keys live only in the gitignored `wallet-access/` folder at mode 0600. They
// are testnet-only material: never reuse them on mainnet, never upload them,
// and never paste them into the game — the game asks for a signature, never a
// key. Everything here talks to chain id 46630 and refuses any other chain.

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicClient, createWalletClient, defineChain, http, formatEther, parseUnits, getContract } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { networkByType } from '../server/chain/networks.js';
import { compileContracts } from './compileContracts.mjs';

const NETWORK = networkByType('testnet');
const VAULT_FILE = resolve(process.cwd(), 'wallet-access/robinhood-testnet.local.json');
const FAUCET = 'https://www.alchemy.com/faucets/robinhood-testnet';
const RPC = process.env.RHC_RPC_HTTP_URL_TESTNET || NETWORK.publicRpcUrl;

const chain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.networkName,
  nativeCurrency: { ...NETWORK.nativeCurrency },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: NETWORK.explorerBaseUrl } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

function readVault() {
  if (!existsSync(VAULT_FILE)) return null;
  return JSON.parse(readFileSync(VAULT_FILE, 'utf8'));
}

function writeVault(vault) {
  mkdirSync(resolve(process.cwd(), 'wallet-access'), { recursive: true });
  writeFileSync(VAULT_FILE, JSON.stringify(vault, null, 2), { mode: 0o600 });
  chmodSync(VAULT_FILE, 0o600);
}

function createVault() {
  const make = (id, name, role) => {
    const privateKey = generatePrivateKey();
    return { id, name, role, privateKey, address: privateKeyToAccount(privateKey).address };
  };
  return {
    network: 'robinhood-testnet',
    chainId: NETWORK.chainId,
    rpc: RPC,
    createdAt: new Date().toISOString(),
    status: 'draft',
    deployer: make('deployer', 'Deployer / token minter', 'authority'),
    // The withdrawal signer is deliberately NOT the vault admin: the key the
    // backend holds can move approved withdrawals and nothing else. It cannot
    // pause the vault, change the allowlist or transfer admin (task8 §14).
    signer: make('signer', 'Withdrawal signer', 'signer'),
    players: [
      make('player_1', 'Test Player One', 'player'),
      make('player_2', 'Test Player Two', 'player'),
      make('player_3', 'Test Player Three', 'player'),
    ],
    token: null,
    vault: null,
  };
}

const allWallets = (vault) => [vault.deployer, vault.signer, ...vault.players].filter(Boolean);
const walletClientFor = (record) => createWalletClient({
  account: privateKeyToAccount(record.privateKey), chain, transport: http(RPC, { timeout: 30_000 }),
});

async function assertChain() {
  const reported = await publicClient.getChainId();
  if (reported !== NETWORK.chainId) {
    throw new Error(`RPC reports chain id ${reported}, expected ${NETWORK.chainId}. Refusing to continue.`);
  }
}

async function status(vault) {
  await assertChain();
  console.log(`\n${NETWORK.networkName} · chain id ${NETWORK.chainId}\nRPC ${RPC}\n`);
  let funded = 0;
  for (const record of allWallets(vault)) {
    const balance = await publicClient.getBalance({ address: record.address });
    if (balance > 0n) funded += 1;
    let tokens = '';
    if (vault.token) {
      const raw = await publicClient.readContract({
        address: vault.token.address,
        abi: [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }],
        functionName: 'balanceOf',
        args: [record.address],
      }).catch(() => 0n);
      tokens = ` · ${(raw / 10n ** 18n).toLocaleString('en-US')} ${vault.token.symbol}`;
    }
    console.log(`  ${record.role.padEnd(9)} ${record.address}  ${formatEther(balance).padStart(12)} ETH${tokens}`);
    console.log(`            ${NETWORK.explorerBaseUrl}/address/${record.address}`);
  }
  if (vault.token) {
    console.log(`\n  token  ${vault.token.address}  ${NETWORK.explorerBaseUrl}/address/${vault.token.address}`);
  }
  if (vault.vault) {
    console.log(`  vault  ${vault.vault.address}  ${NETWORK.explorerBaseUrl}/address/${vault.vault.address}`);
    console.log(`  deployment block ${vault.vault.deploymentBlock}`);
  }
  if (!funded) {
    console.log(`\n  No wallet holds ETH yet. Request 0.1 ETH per address (once every 24 h) at:\n  ${FAUCET}`);
    console.log('  Fund the deployer first — it pays for both contract deployments.');
  }
  return funded;
}

async function fundPlayers(vault) {
  await assertChain();
  const client = walletClientFor(vault.deployer);
  const balance = await publicClient.getBalance({ address: vault.deployer.address });
  if (balance === 0n) throw new Error(`Deployer has no ETH. Request testnet ETH at ${FAUCET}`);
  // Enough for an approve plus a deposit on an L2, with headroom.
  const share = 5_000_000_000_000_000n; // 0.005 ETH
  for (const player of [vault.signer, ...vault.players].filter(Boolean)) {
    const current = await publicClient.getBalance({ address: player.address });
    if (current >= share) { console.log(`  ${player.name} already funded (${formatEther(current)} ETH)`); continue; }
    const hash = await client.sendTransaction({ to: player.address, value: share - current });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${player.name} funded · ${NETWORK.explorerBaseUrl}/tx/${hash}`);
  }
}

async function deploy(vault) {
  await assertChain();
  const balance = await publicClient.getBalance({ address: vault.deployer.address });
  if (balance === 0n) throw new Error(`Deployer has no ETH. Request testnet ETH at ${FAUCET}`);
  const artifacts = compileContracts();
  const client = walletClientFor(vault.deployer);
  const account = privateKeyToAccount(vault.deployer.privateKey);

  if (!vault.token) {
    const supply = parseUnits('10000000', 18);
    console.log('  Deploying TestProjectToken…');
    const hash = await client.deployContract({
      abi: artifacts.TestProjectToken.abi,
      bytecode: artifacts.TestProjectToken.bytecode,
      args: [account.address, supply],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    vault.token = {
      address: receipt.contractAddress, symbol: 'TCITY', decimals: 18,
      deploymentTx: hash, deploymentBlock: Number(receipt.blockNumber),
    };
    writeVault(vault);
    console.log(`  token ${receipt.contractAddress} · ${NETWORK.explorerBaseUrl}/tx/${hash}`);
  }

  if (!vault.vault) {
    console.log('  Deploying TokenCityVault…');
    const hash = await client.deployContract({
      abi: artifacts.TokenCityVault.abi,
      bytecode: artifacts.TokenCityVault.bytecode,
      args: [account.address],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    vault.vault = { address: receipt.contractAddress, deploymentTx: hash, deploymentBlock: Number(receipt.blockNumber) };
    writeVault(vault);
    console.log(`  vault ${receipt.contractAddress} · ${NETWORK.explorerBaseUrl}/tx/${hash}`);
  }

  const vaultContract = getContract({ address: vault.vault.address, abi: artifacts.TokenCityVault.abi, client });
  if (!await publicClient.readContract({
    address: vault.vault.address, abi: artifacts.TokenCityVault.abi,
    functionName: 'supportedToken', args: [vault.token.address],
  })) {
    const hash = await vaultContract.write.setSupportedToken([vault.token.address, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('  vault: token allowlisted');
  }

  // The backend never holds the vault admin: only this key is a withdrawer.
  const signerAddress = process.env.RHC_SIGNER_ADDRESS || vault.signer?.address || account.address;
  if (!await publicClient.readContract({
    address: vault.vault.address, abi: artifacts.TokenCityVault.abi,
    functionName: 'isWithdrawer', args: [signerAddress],
  })) {
    const hash = await vaultContract.write.setWithdrawer([signerAddress, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  vault: withdrawer ${signerAddress}`);
  }
  vault.withdrawer = signerAddress;

  const tokenAbi = artifacts.TestProjectToken.abi;
  const perPlayer = parseUnits('250000', 18);
  for (const player of vault.players) {
    const held = await publicClient.readContract({
      address: vault.token.address, abi: tokenAbi, functionName: 'balanceOf', args: [player.address],
    });
    if (held >= perPlayer) { console.log(`  ${player.name} already holds ${held / 10n ** 18n} TCITY`); continue; }
    const hash = await client.writeContract({
      address: vault.token.address, abi: tokenAbi, functionName: 'mint',
      args: [player.address, perPlayer - held],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${player.name} minted 250,000 TCITY`);
  }

  // Seed the vault so a withdrawal can be tested before any deposit exists.
  const vaultHeld = await publicClient.readContract({
    address: vault.token.address, abi: tokenAbi, functionName: 'balanceOf', args: [vault.vault.address],
  });
  const seed = parseUnits('500000', 18);
  if (vaultHeld < seed) {
    const hash = await client.writeContract({
      address: vault.token.address, abi: tokenAbi, functionName: 'mint', args: [vault.vault.address, seed - vaultHeld],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log('  vault seeded with 500,000 TCITY for withdrawal tests');
  }

  vault.status = 'ready';
  writeVault(vault);

  console.log(`\nPaste these into /token-admin.html on a deployment running testnet 46630:\n`);
  console.log(`  Token contract address     ${vault.token.address}`);
  console.log(`  Expected token name        Token City Test`);
  console.log(`  Expected token symbol      TCITY`);
  console.log(`  Expected decimals          18`);
  console.log(`  Deposit contract address   ${vault.vault.address}`);
  console.log(`  Deposit vault address      ${vault.vault.address}`);
  console.log(`  Monitoring start block     ${vault.vault.deploymentBlock}`);
  console.log(`\nSet RHC_SIGNER_PRIVATE_KEY in the Convex deployment to the withdrawer key.`);
  console.log(`Withdrawer address: ${vault.withdrawer} (its key is the "signer" entry in ${VAULT_FILE})`);
}

const command = process.argv[2] || 'status';
let vault = readVault();
if (!vault) {
  vault = createVault();
  writeVault(vault);
  console.log(`Created ${VAULT_FILE} (mode 0600, gitignored).`);
  console.log('These are testnet-only keys. Never reuse them on mainnet.');
}

try {
  if (command === 'status') await status(vault);
  else if (command === 'fund') { await fundPlayers(vault); await status(vault); }
  else if (command === 'deploy') { await deploy(vault); await status(vault); }
  else { console.error(`Unknown command "${command}". Use status, fund or deploy.`); process.exitCode = 1; }
} catch (error) {
  console.error(`\n${error.shortMessage || error.message}`);
  process.exitCode = 1;
}
