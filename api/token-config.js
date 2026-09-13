// Public sanitized token configuration (task8 §8).
//
// The browser never hard-codes a contract address and never receives an RPC
// key, a signer reference, an admin role or an internal risk threshold.

import { api } from '../convex/_generated/api.js';
import { convexClient } from '../server/convexClient.js';
import { networkForEnvironment } from '../server/chain/networks.js';
import { secureJson } from '../server/httpSecurity.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') return secureJson(response, 405, { error: 'Method not allowed' });
  const network = networkForEnvironment(process.env.VERCEL_ENV, process.env.RHC_ENVIRONMENT);
  try {
    const config = await convexClient().query(api.chain.activeTokenConfig, { environment: network.networkType });
    let blackout = false;
    try {
      const flag = await convexClient().query(api.chain.siteBlackout, {});
      blackout = Boolean(flag?.enabled);
    } catch { /* a flag read failure must never take the whole site down */ }
    return secureJson(response, 200, {
      network: {
        networkName: network.networkName,
        networkType: network.networkType,
        chainId: network.chainId,
        chainFamily: network.chainFamily,
        nativeCurrency: { ...network.nativeCurrency },
        publicRpcUrl: network.publicRpcUrl,
        explorerBaseUrl: network.explorerBaseUrl,
      },
      token: config,
      status: config ? config.status : 'UNCONFIGURED',
      blackout,
      walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null,
    });
  } catch (error) {
    return secureJson(response, 503, {
      network: {
        networkName: network.networkName,
        networkType: network.networkType,
        chainId: network.chainId,
        chainFamily: network.chainFamily,
        nativeCurrency: { ...network.nativeCurrency },
        publicRpcUrl: network.publicRpcUrl,
        explorerBaseUrl: network.explorerBaseUrl,
      },
      token: null,
      status: 'UNAVAILABLE',
      error: 'Token configuration is temporarily unavailable',
      detail: String(error?.message || '').slice(0, 200),
    });
  }
}
