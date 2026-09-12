// Robinhood Chain network registry (task8 §2).
//
// Robinhood Chain is an EVM-compatible Arbitrum L2. Everything network specific
// lives here so no game module has to know a chain id literal. Solana values are
// intentionally absent: historical Solana records are labelled with their own
// chain family in the database, not resolved through this table.

export const CHAIN_FAMILY_EVM = 'evm';
export const CHAIN_FAMILY_SOLANA = 'solana';

export const ROBINHOOD_CHAINS = Object.freeze({
  mainnet: Object.freeze({
    networkId: 'robinhood-mainnet',
    networkType: 'mainnet',
    chainId: 4663,
    chainFamily: CHAIN_FAMILY_EVM,
    networkName: 'Robinhood Chain',
    nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 }),
    publicRpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
    explorerBaseUrl: 'https://robinhoodchain.blockscout.com',
    // Alchemy is the provider Robinhood documents for production traffic.
    providerHttpTemplate: 'https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
    providerWsTemplate: 'wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}',
  }),
  testnet: Object.freeze({
    networkId: 'robinhood-testnet',
    networkType: 'testnet',
    chainId: 46630,
    chainFamily: CHAIN_FAMILY_EVM,
    networkName: 'Robinhood Chain Testnet',
    nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 }),
    publicRpcUrl: 'https://rpc.testnet.chain.robinhood.com',
    explorerBaseUrl: 'https://explorer.testnet.chain.robinhood.com',
    providerHttpTemplate: 'https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
    providerWsTemplate: 'wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}',
  }),
});

/** task8 §17: Development and Preview are testnet, Production is mainnet. */
export const VERCEL_ENVIRONMENT_NETWORK = Object.freeze({
  development: 'testnet',
  preview: 'testnet',
  production: 'mainnet',
});

const BY_CHAIN_ID = new Map(Object.values(ROBINHOOD_CHAINS).map((entry) => [entry.chainId, entry]));

export function networkByType(networkType) {
  const entry = ROBINHOOD_CHAINS[String(networkType || '').trim().toLowerCase()];
  if (!entry) throw new Error(`Unknown Robinhood Chain environment: ${networkType}`);
  return entry;
}

export function networkByChainId(chainId) {
  const entry = BY_CHAIN_ID.get(Number(chainId));
  if (!entry) throw new Error(`Chain id ${chainId} is not a Robinhood Chain network`);
  return entry;
}

export function isSupportedChainId(chainId) {
  return BY_CHAIN_ID.has(Number(chainId));
}

/**
 * The chain a deployment is allowed to use. `vercelEnv` comes from the
 * VERCEL_ENV system variable; an explicit override is accepted only when it
 * still resolves to a known Robinhood network, so a misconfigured variable
 * fails loudly instead of silently running mainnet in preview.
 */
export function networkForEnvironment(vercelEnv, override = '') {
  const requested = String(override || '').trim().toLowerCase();
  if (requested) return networkByType(requested);
  const mapped = VERCEL_ENVIRONMENT_NETWORK[String(vercelEnv || '').trim().toLowerCase()];
  return networkByType(mapped || 'testnet');
}

export function explorerAddressUrl(network, address) {
  return `${networkByType(network.networkType).explorerBaseUrl}/address/${address}`;
}

export function explorerTxUrl(network, transactionHash) {
  return `${networkByType(network.networkType).explorerBaseUrl}/tx/${transactionHash}`;
}

export function explorerTokenUrl(network, tokenAddress) {
  return `${networkByType(network.networkType).explorerBaseUrl}/token/${tokenAddress}`;
}

/** Metadata for wallet_addEthereumChain — never includes a paid provider key. */
export function walletNetworkMetadata(networkType) {
  const network = networkByType(networkType);
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.networkName,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: [network.publicRpcUrl],
    blockExplorerUrls: [network.explorerBaseUrl],
  };
}
