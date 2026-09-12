import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import { consolePage, loginPage } from './server/adminConsole.js';
import { networkForEnvironment } from './server/chain/networks.js';

const DEV_ADMIN_COOKIE = 'tc_admin_dev=1';
const DEV_ADMIN_PASSWORD = process.env.TOKEN_CITY_ADMIN_PASSWORD || 'TokenCity-Ember-8264';

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(payload));
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        game: resolve(process.cwd(), 'index.html'),
      },
    },
  },
  plugins: [{
    name: 'token-city-dev-endpoints',
    configureServer(server) {
      const network = networkForEnvironment('development', process.env.RHC_ENVIRONMENT);
      const authorized = (request) => String(request.headers.cookie || '').includes(DEV_ADMIN_COOKIE);

      // The operations console is server-rendered in development too, so the
      // protected page has exactly one implementation (task8 §7.1).
      server.middlewares.use('/token-admin.html', (request, response) => {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
        response.statusCode = authorized(request) ? 200 : 401;
        response.end(authorized(request)
          ? consolePage({
            networkName: network.networkName,
            networkType: network.networkType,
            chainId: network.chainId,
            explorerBaseUrl: network.explorerBaseUrl,
          })
          : loginPage());
      });

      server.middlewares.use('/api/admin-session', async (request, response) => {
        if (request.method === 'GET') {
          return json(response, authorized(request) ? 200 : 401, {
            authenticated: authorized(request),
            csrfToken: authorized(request) ? 'dev-csrf' : null,
          });
        }
        const payload = await readJsonBody(request);
        if (payload.action === 'logout') {
          response.setHeader('set-cookie', 'tc_admin_dev=; Path=/; SameSite=Strict; Max-Age=0');
          return json(response, 200, { authenticated: false });
        }
        if (payload.password !== DEV_ADMIN_PASSWORD) return json(response, 401, { error: 'Wrong password' });
        response.setHeader('set-cookie', `${DEV_ADMIN_COOKIE}; Path=/; SameSite=Strict; Max-Age=28800`);
        return json(response, 200, { authenticated: true, csrfToken: 'dev-csrf' });
      });

      // Development proxies the real Convex deployment, so the admin flow that
      // is tested locally is the same code path production runs.
      const convexCall = async (kind, name, args) => {
        const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL;
        if (!url) throw new Error('CONVEX_URL is not configured for local development');
        const result = await fetch(`${url.replace(/\/$/, '')}/api/${kind}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: name, args, format: 'json' }),
        });
        const payload = await result.json();
        if (payload.status === 'error') throw new Error(payload.errorMessage || 'Convex call failed');
        return payload.value;
      };

      server.middlewares.use('/api/token-config', async (request, response) => {
        const shell = {
          network: {
            networkName: network.networkName,
            networkType: network.networkType,
            chainId: network.chainId,
            chainFamily: network.chainFamily,
            nativeCurrency: { ...network.nativeCurrency },
            publicRpcUrl: network.publicRpcUrl,
            explorerBaseUrl: network.explorerBaseUrl,
          },
          walletConnectProjectId: process.env.WALLETCONNECT_PROJECT_ID || null,
        };
        try {
          const token = await convexCall('query', 'chain:activeTokenConfig', { environment: network.networkType });
          return json(response, 200, { ...shell, token, status: token ? token.status : 'UNCONFIGURED' });
        } catch (error) {
          return json(response, 200, { ...shell, token: null, status: 'UNAVAILABLE', detail: error.message });
        }
      });

      server.middlewares.use('/api/token-admin', async (request, response) => {
        if (!authorized(request)) return json(response, 401, { error: 'Admin session required' });
        const serviceSecret = process.env.CHAIN_SERVICE_SECRET || '';
        const body = request.method === 'POST' ? await readJsonBody(request) : {};
        const url = new URL(request.url, 'http://localhost');
        const action = String(body.action || url.searchParams.get('action') || 'environment');
        const environment = { ...network, allowedEnvironment: network.networkType, vercelEnv: 'development' };
        try {
          if (action === 'environment') return json(response, 200, { environment });
          if (action === 'list') {
            const [configs, active] = await Promise.all([
              convexCall('query', 'chain:tokenConfigList', { environment: network.networkType, serviceSecret }),
              convexCall('query', 'chain:activeTokenConfig', { environment: network.networkType }),
            ]);
            const { activationConfirmationPhrase } = await import('./server/chain/tokenConfig.js');
            return json(response, 200, {
              environment,
              active,
              configs: configs.map((config) => ({ ...config, confirmationPhrase: activationConfirmationPhrase(config) })),
            });
          }
          if (action === 'audit') {
            return json(response, 200, { entries: await convexCall('query', 'chain:auditTail', { serviceSecret, limit: 20 }) });
          }
          if (action === 'health') {
            return json(response, 200, { health: await convexCall('action', 'chainActions:chainHealth', { serviceSecret }) });
          }
          if (action === 'validate') {
            const result = await convexCall('action', 'chainActions:validateTokenContract', {
              serviceSecret,
              input: { ...body.input, environment: network.networkType },
              adminUserId: 'admin_dev',
              requestId: `req_dev_${Date.now()}`,
              sourceIpHash: 'dev',
            });
            const { activationConfirmationPhrase } = await import('./server/chain/tokenConfig.js');
            return json(response, 200, { ...result, confirmationPhrase: activationConfirmationPhrase(result) });
          }
          if (action === 'activate') {
            return json(response, 200, await convexCall('action', 'chainActions:activateTokenConfig', {
              serviceSecret,
              tokenConfigId: String(body.tokenConfigId || ''),
              confirmationPhrase: String(body.confirmationPhrase || ''),
              adminUserId: 'admin_dev',
              requestId: `req_dev_${Date.now()}`,
              sourceIpHash: 'dev',
            }));
          }
          if (action === 'status') {
            return json(response, 200, {
              config: await convexCall('action', 'chainActions:setTokenConfigStatus', {
                serviceSecret,
                tokenConfigId: String(body.tokenConfigId || ''),
                status: String(body.status || ''),
                adminUserId: 'admin_dev',
                requestId: `req_dev_${Date.now()}`,
                sourceIpHash: 'dev',
              }),
            });
          }
          return json(response, 400, { error: `Unknown admin action “${action}”` });
        } catch (error) {
          return json(response, 400, { error: error.message });
        }
      });

      // The Solana public contract address stays readable for history, but the
      // write path is retired so no new Solana configuration can be created
      // (task8 §19.4). Development mirrors what the deployed function returns.
      server.middlewares.use('/api/public-config', (request, response) => {
        if (request.method === 'POST') {
          return json(response, 410, {
            error: 'Solana token configuration is retired. Use the protected Robinhood Chain operations console.',
            replacement: '/api/token-config',
          });
        }
        return json(response, 200, { contractAddress: '', updatedAt: 0, chainFamily: 'solana', legacy: true });
      });

      // Historical Solana pool data stays readable during the migration (§19.1)
      // but no new Solana configuration can be written from here (§19.4).
      server.middlewares.use('/api/pool', async (request, response) => {
        try {
          if (request.method !== 'GET') throw new Error('Solana pool writes are disabled during the Robinhood Chain migration');
          const data = JSON.parse(await readFile(resolve(process.cwd(), '.token-city-pool.local.json'), 'utf8'));
          return json(response, 200, {
            status: data.status,
            network: data.network,
            rpcUrl: data.rpc,
            mint: data.mint,
            poolWallet: data.pool?.address,
            decimals: data.decimals,
            poolBalance: 0,
            legacy: true,
          });
        } catch (error) {
          return json(response, 404, { error: error?.message || 'Local pool is not ready' });
        }
      });

      server.middlewares.use('/__local-test-wallets', async (request, response) => {
        const target = resolve(process.cwd(), '.token-city-solana.local.json');
        try {
          if (request.method === 'POST') {
            const payload = await readJsonBody(request);
            if (payload?.network !== 'devnet' || payload?.status !== 'ready'
                || !payload?.mint || payload?.wallets?.length !== 3) {
              throw new Error('Invalid local Devnet vault');
            }
            await writeFile(target, JSON.stringify(payload, null, 2), { mode: 0o600 });
            await chmod(target, 0o600);
            return json(response, 200, { ok: true });
          }
          const data = await readFile(target, 'utf8');
          response.setHeader('content-type', 'application/json');
          response.setHeader('cache-control', 'no-store');
          response.end(data);
        } catch {
          return json(response, 404, { error: 'Local test wallets have not been prepared' });
        }
      });
    },
  }],
});
