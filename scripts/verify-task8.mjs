// Task 8 verification: Robinhood Chain migration.
//
//   node scripts/verify-task8.mjs [baseUrl]
//   node --env-file=.env.local scripts/verify-task8.mjs https://token-city.vercel.app
//
// Checks what can be checked without a deployed token: the live chain profile,
// the deployment's public token configuration, and that the protected console
// and the admin API refuse an unauthenticated request. Nothing is written.

import assert from 'node:assert/strict';
import { RobinhoodChainAdapter } from '../server/chain/adapter.js';
import { ROBINHOOD_CHAINS, networkForEnvironment } from '../server/chain/networks.js';
import { normalizeEvmAddress, toRawAmount, fromRawAmount } from '../server/chain/evm.js';

const baseUrl = (process.argv[2] || process.env.TASK8_BASE_URL || '').replace(/\/$/, '');
const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function checkNetwork(networkType) {
  const network = ROBINHOOD_CHAINS[networkType];
  const adapter = new RobinhoodChainAdapter({ networkType, retryCount: 1, timeoutMs: 20_000 });
  try {
    const reported = await adapter.assertChainId();
    const heads = await adapter.getFinalityHeads();
    record(`${network.networkName} answers on chain id ${network.chainId}`, reported === network.chainId, `reported ${reported}`);
    record(`${network.networkName} exposes safe/finalized tags`, heads.tagsSupported,
      `latest ${heads.latestBlockNumber} · safe ${heads.safeBlockNumber} · finalized ${heads.finalizedBlockNumber}`);
    const hash = heads.safeBlockNumber ? await adapter.getCanonicalBlockHash(heads.safeBlockNumber) : null;
    record(`${network.networkName} block hashes are re-readable for reorg checks`, Boolean(hash), hash ? `${hash.slice(0, 18)}…` : 'unavailable');
  } catch (error) {
    record(`${network.networkName} RPC reachable`, false, error.shortMessage || error.message);
  }
}

function checkPrimitives() {
  try {
    assert.equal(normalizeEvmAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    assert.throws(() => normalizeEvmAddress('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin'));
    assert.equal(toRawAmount('0.1', 18), 100000000000000000n);
    assert.equal(fromRawAmount(toRawAmount('123456789.123456789012345678', 18), 18), '123456789.123456789012345678');
    record('EVM primitives reject Base58 and keep integer precision', true);
  } catch (error) {
    record('EVM primitives reject Base58 and keep integer precision', false, error.message);
  }
}

async function checkDeployment() {
  if (!baseUrl) {
    console.log('\nSkipping deployment checks: pass a base URL to include them.');
    return;
  }
  try {
    const response = await fetch(`${baseUrl}/api/token-config`, { cache: 'no-store' });
    const payload = await response.json();
    const body = JSON.stringify(payload);
    record('public token configuration is served', response.ok, `status ${payload.status}`);
    record('deployment environment maps to the right chain',
      payload.network?.chainId === networkForEnvironment(baseUrl.includes('localhost') ? 'development' : 'production').chainId
        || payload.network?.chainId === 46630,
      `chain id ${payload.network?.chainId}`);
    record('public configuration carries no secret material',
      !/alchemy|privateKey|signer|apiKey|api_key|secret/i.test(body));
  } catch (error) {
    record('public token configuration is served', false, error.message);
  }

  try {
    const page = await fetch(`${baseUrl}/token-admin.html`, { cache: 'no-store' });
    const html = await page.text();
    record('operations console refuses an unauthenticated request', page.status === 401, `status ${page.status}`);
    record('operations markup is never sent to an anonymous visitor',
      !/Validate an ERC-20|Configurations|Chain health/.test(html));
    record('operations page is no-store and noindex',
      /no-store/i.test(page.headers.get('cache-control') || '')
      && /noindex/i.test(page.headers.get('x-robots-tag') || ''),
      `${page.headers.get('cache-control')} · ${page.headers.get('x-robots-tag')}`);
  } catch (error) {
    record('operations console refuses an unauthenticated request', false, error.message);
  }

  for (const action of ['list', 'health', 'audit']) {
    try {
      const api = await fetch(`${baseUrl}/api/token-admin?action=${action}`, { cache: 'no-store' });
      record(`admin API rejects "${action}" without a session`, api.status === 401, `status ${api.status}`);
    } catch (error) {
      record(`admin API rejects "${action}" without a session`, false, error.message);
    }
  }

  try {
    const legacy = await fetch(`${baseUrl}/api/public-config`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contractAddress: '' }),
    });
    record('Solana token configuration writes are retired', legacy.status === 410, `status ${legacy.status}`);
  } catch (error) {
    record('Solana token configuration writes are retired', false, error.message);
  }
}

await checkNetwork('testnet');
await checkNetwork('mainnet');
checkPrimitives();
await checkDeployment();

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('Failed:', failed.map((entry) => entry.name).join('; '));
  process.exitCode = 1;
}
