// Protected token administration API (task8 §7).
//
// Independently authorized from the page: knowing this URL grants nothing. Every
// call requires the admin session cookie, a matching CSRF token, a same-origin
// request and passes the rate limiter before it reaches Convex.

import { api } from '../convex/_generated/api.js';
import { adminContext } from './admin-session.js';
import { chainServiceSecret, convexClient } from '../server/convexClient.js';
import { networkForEnvironment } from '../server/chain/networks.js';
import { activationConfirmationPhrase } from '../server/chain/tokenConfig.js';
import {
  bodyOf, clientIpHash, csrfValid, newRequestId, originAllowed, rateLimit, secureJson,
} from '../server/httpSecurity.js';

const READ_ACTIONS = new Set(['list', 'health', 'audit', 'environment']);

export default async function handler(request, response) {
  if (!['GET', 'POST'].includes(request.method)) {
    return secureJson(response, 405, { error: 'Method not allowed' }, { noindex: true });
  }
  const context = adminContext(request);
  if (!context) return secureJson(response, 401, { error: 'Admin session required' }, { noindex: true });

  const body = request.method === 'POST' ? bodyOf(request) : {};
  const action = String((request.method === 'GET' ? request.query?.action : body.action) || 'environment');
  const requestId = newRequestId();
  const sourceIpHash = clientIpHash(request, context.secret);

  if (!READ_ACTIONS.has(action)) {
    if (!originAllowed(request)) return secureJson(response, 403, { error: 'Cross-origin admin request rejected', requestId }, { noindex: true });
    if (!csrfValid(request, context.sessionValue, context.secret)) {
      return secureJson(response, 403, { error: 'Invalid CSRF token. Reload the operations page.', requestId }, { noindex: true });
    }
  }
  const limit = rateLimit(`admin-api:${sourceIpHash}:${action}`, { limit: READ_ACTIONS.has(action) ? 60 : 12, windowMs: 60_000 });
  if (!limit.allowed) return secureJson(response, 429, { error: 'Rate limit reached for this action', requestId }, { noindex: true });

  const network = networkForEnvironment(process.env.VERCEL_ENV, process.env.RHC_ENVIRONMENT);
  const environment = { ...network, allowedEnvironment: network.networkType, vercelEnv: process.env.VERCEL_ENV || 'development' };

  try {
    const convex = convexClient();
    const serviceSecret = chainServiceSecret();

    if (action === 'environment') return secureJson(response, 200, { environment, requestId }, { noindex: true });

    if (action === 'list') {
      const configs = await convex.query(api.chain.tokenConfigList, { environment: network.networkType, serviceSecret });
      const active = await convex.query(api.chain.activeTokenConfig, { environment: network.networkType });
      return secureJson(response, 200, {
        environment,
        active,
        configs: configs.map((config) => ({ ...config, confirmationPhrase: activationConfirmationPhrase(config) })),
        requestId,
      }, { noindex: true });
    }

    if (action === 'audit') {
      const entries = await convex.query(api.chain.auditTail, { serviceSecret, limit: 20 });
      return secureJson(response, 200, { entries, requestId }, { noindex: true });
    }

    if (action === 'health') {
      const health = await convex.action(api.chainActions.chainHealth, { serviceSecret });
      return secureJson(response, 200, { health, requestId }, { noindex: true });
    }

    if (action === 'validate') {
      const result = await convex.action(api.chainActions.validateTokenContract, {
        serviceSecret,
        input: { ...body.input, environment: network.networkType },
        adminUserId: context.adminUserId,
        requestId,
        sourceIpHash,
      });
      return secureJson(response, 200, {
        ...result,
        confirmationPhrase: activationConfirmationPhrase(result),
        requestId,
      }, { noindex: true });
    }

    if (action === 'activate') {
      const result = await convex.action(api.chainActions.activateTokenConfig, {
        serviceSecret,
        tokenConfigId: String(body.tokenConfigId || ''),
        confirmationPhrase: String(body.confirmationPhrase || ''),
        adminUserId: context.adminUserId,
        requestId,
        sourceIpHash,
      });
      return secureJson(response, 200, { ...result, requestId }, { noindex: true });
    }

    if (action === 'status') {
      const result = await convex.action(api.chainActions.setTokenConfigStatus, {
        serviceSecret,
        tokenConfigId: String(body.tokenConfigId || ''),
        status: String(body.status || ''),
        adminUserId: context.adminUserId,
        requestId,
        sourceIpHash,
      });
      return secureJson(response, 200, { config: result, requestId }, { noindex: true });
    }

    return secureJson(response, 400, { error: `Unknown admin action “${action}”`, requestId }, { noindex: true });
  } catch (error) {
    // Convex surfaces its own error text; nothing here echoes a secret back.
    const message = String(error?.message || 'Admin request failed')
      .replace(/\[Request ID:[^\]]*\]/g, '')
      .replace(/^.*Uncaught Error:\s*/s, '')
      .split('\n')[0]
      .slice(0, 300);
    return secureJson(response, 400, { error: message, requestId }, { noindex: true });
  }
}
