// Shared response and request hardening for the protected admin surface
// (task8 §7.1, §20).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function secureJson(response, status, payload, { noindex = false } = {}) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store, max-age=0, must-revalidate');
  response.setHeader('pragma', 'no-cache');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  if (noindex) response.setHeader('x-robots-tag', 'noindex, nofollow, noarchive');
  response.end(JSON.stringify(payload));
}

export function readCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, rest.join('=')];
  }).filter(([key]) => key));
}

export function bodyOf(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string') return JSON.parse(request.body || '{}');
  return {};
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Double-submit CSRF token derived from the session cookie value. */
export function csrfTokenFor(sessionValue, secret) {
  return createHmac('sha256', secret).update(`token-city-csrf:${sessionValue}`).digest('hex');
}

export function csrfValid(request, sessionValue, secret) {
  const provided = request.headers['x-csrf-token'] || bodyOf(request)?.csrfToken;
  return safeEqual(provided, csrfTokenFor(sessionValue, secret));
}

/**
 * Same-origin check. A protected admin mutation must not be reachable from a
 * page the operator did not open themselves.
 */
export function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;                 // non-browser client, CSRF token still applies
  const host = request.headers['x-forwarded-host'] || request.headers.host;
  try { return new URL(origin).host === host; }
  catch { return false; }
}

const buckets = new Map();

/** In-memory rate limit. One instance is a best-effort layer in front of the
 * durable audit log, not the only control. */
export function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 2000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function clientIpHash(request, secret) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || request.socket?.remoteAddress || 'unknown';
  return createHmac('sha256', secret || 'token-city').update(ip).digest('hex').slice(0, 32);
}

export function newRequestId() {
  return `req_${randomBytes(8).toString('hex')}`;
}
