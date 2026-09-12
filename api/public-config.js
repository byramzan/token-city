// Legacy Solana public contract address (task8 §19.1).
//
// Historical records stay readable so old transactions and links still resolve,
// but no new Solana configuration can be written: the active project token is
// now the versioned Robinhood Chain configuration served by /api/token-config.
import { PUBLIC_CONFIG_KEY, normalizePublicConfig } from '../server/publicConfig.js';

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store, max-age=0');
  response.end(JSON.stringify(payload));
}

async function redisCommand(command, { write = false } = {}) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = write
    ? (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)
    : (process.env.KV_REST_API_READ_ONLY_TOKEN || process.env.KV_REST_API_TOKEN
      || process.env.UPSTASH_REDIS_REST_TOKEN);
  if (!url || !token) throw new Error('Public configuration storage is unavailable');
  const result = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok || payload.error) throw new Error(payload.error || 'Public configuration storage failed');
  return payload.result;
}

export default async function handler(request, response) {
  if (request.method === 'POST') {
    return json(response, 410, {
      error: 'Solana token configuration is retired. Use the protected Robinhood Chain operations console.',
      replacement: '/api/token-config',
    });
  }
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
  try {
    const value = await redisCommand(['GET', PUBLIC_CONFIG_KEY]);
    return json(response, 200, { ...normalizePublicConfig(value || {}), chainFamily: 'solana', legacy: true });
  } catch (error) {
    return json(response, 400, { error: error?.message || 'Public configuration request failed' });
  }
}
