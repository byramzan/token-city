// Deploy TokenCityVault on Robinhood Chain MAINNET (4663).
//
//   RHC_DEPLOYER_PRIVATE_KEY=0x...  node scripts/deploy-mainnet-vault.mjs
//
// Optional env:
//   RHC_TOKEN_ADDRESS       token to allowlist (default: the address below)
//   RHC_SIGNER_ADDRESS      withdrawer address to grant (default: the deployer)
//   RHC_RPC_HTTP_URL_MAINNET custom RPC (default: the public Robinhood RPC)
//
// The deployer key is read ONLY from the environment — it is never written to
// disk or committed. The deployer pays gas (real ETH on Robinhood mainnet) and
// becomes the vault admin. Keep the admin key offline after setup; the backend
// only ever needs the separate withdrawer key.

import { createPublicClient, createWalletClient, defineChain, http, formatEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { networkByType } from '../server/chain/networks.js';
import { compileContracts } from './compileContracts.mjs';

const NETWORK = networkByType('mainnet');
const RPC = process.env.RHC_RPC_HTTP_URL_MAINNET || NETWORK.publicRpcUrl;
// The token address you provided. Override with RHC_TOKEN_ADDRESS if needed.
const TOKEN_ADDRESS = (process.env.RHC_TOKEN_ADDRESS || '0xef05544fba41d574f75dbc69f155c99b2ef6723e').trim();

const chain = defineChain({
  id: NETWORK.chainId,
  name: NETWORK.networkName,
  nativeCurrency: { ...NETWORK.nativeCurrency },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: NETWORK.explorerBaseUrl } },
});
const publicClient = createPublicClient({ chain, transport: http(RPC, { timeout: 30_000 }) });

async function main() {
  const key = (process.env.RHC_DEPLOYER_PRIVATE_KEY || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('Set RHC_DEPLOYER_PRIVATE_KEY to the deployer wallet private key (0x + 64 hex).');
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(TOKEN_ADDRESS)) {
    throw new Error(`RHC_TOKEN_ADDRESS is not a valid address: ${TOKEN_ADDRESS}`);
  }

  const reported = await publicClient.getChainId();
  if (reported !== NETWORK.chainId) {
    throw new Error(`RPC reports chain id ${reported}, expected ${NETWORK.chainId} (mainnet). Refusing to continue.`);
  }

  const account = privateKeyToAccount(key);
  const client = createWalletClient({ account, chain, transport: http(RPC, { timeout: 30_000 }) });
  const signerAddress = (process.env.RHC_SIGNER_ADDRESS || account.address).trim();

  console.log(`\n${NETWORK.networkName} · chain id ${NETWORK.chainId}\nRPC ${RPC}`);
  console.log(`Deployer  ${account.address}`);
  console.log(`Token     ${TOKEN_ADDRESS}`);
  console.log(`Withdrawer ${signerAddress}\n`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Deployer ETH balance: ${formatEther(balance)} ETH`);
  if (balance === 0n) throw new Error('Deployer has no ETH on Robinhood mainnet. Fund it before deploying.');

  // The vault must not be the same address as the token (backend rule).
  if (TOKEN_ADDRESS.toLowerCase() === account.address.toLowerCase()) {
    throw new Error('The token address must not equal the deployer address.');
  }

  const artifacts = compileContracts();

  console.log('\nDeploying TokenCityVault…');
  const deployHash = await client.deployContract({
    abi: artifacts.TokenCityVault.abi,
    bytecode: artifacts.TokenCityVault.bytecode,
    args: [account.address], // initialAdmin
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const vaultAddress = receipt.contractAddress;
  const deploymentBlock = Number(receipt.blockNumber);
  console.log(`  vault ${vaultAddress}`);
  console.log(`  ${NETWORK.explorerBaseUrl}/tx/${deployHash}`);
  console.log(`  deployment block ${deploymentBlock}`);

  const vaultContract = getContract({ address: vaultAddress, abi: artifacts.TokenCityVault.abi, client });

  // Allowlist the project token.
  console.log('\nAllowlisting the token…');
  const supHash = await vaultContract.write.setSupportedToken([TOKEN_ADDRESS, true]);
  await publicClient.waitForTransactionReceipt({ hash: supHash });
  console.log(`  token allowlisted · ${NETWORK.explorerBaseUrl}/tx/${supHash}`);

  // Grant the withdrawer role (used by the backend signer for withdrawals).
  console.log('\nGranting the withdrawer role…');
  const wHash = await vaultContract.write.setWithdrawer([signerAddress, true]);
  await publicClient.waitForTransactionReceipt({ hash: wHash });
  console.log(`  withdrawer ${signerAddress} · ${NETWORK.explorerBaseUrl}/tx/${wHash}`);

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Vault is live. Configure the backend and activate the token:\n');
  console.log(`1) Set in the Convex PRODUCTION deployment environment:`);
  console.log(`     RHC_VAULT_ADDRESS = ${vaultAddress}`);
  console.log(`     RHC_RPC_HTTP_URL_MAINNET = <your mainnet RPC>  (recommended)`);
  console.log(`     RHC_SIGNER_PRIVATE_KEY = <the withdrawer key>  (for withdrawals)`);
  console.log(`     RHC_ALLOW_ENV_SIGNER_ON_MAINNET = true         (to allow an env signer)`);
  console.log(`2) Open /token-admin.html, paste ONLY the token address, Validate, then Activate.`);
  console.log(`3) Seed the vault with tokens so withdrawals can pay out.`);
  console.log(`\nRecord: monitoring start block = ${deploymentBlock}`);
  console.log('──────────────────────────────────────────────────────────────\n');
}

main().catch((error) => {
  console.error(`\n${error.shortMessage || error.message}`);
  process.exitCode = 1;
});
