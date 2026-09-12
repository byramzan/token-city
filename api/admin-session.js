// Protected admin session (task8 §7.1).
//
// The session cookie is HttpOnly and Secure; a matching CSRF token is returned
// in the JSON body so a mutating admin call has to be made by a page the
// operator actually opened. The password and secret never leave the server.

import { createHmac } from 'node:crypto';
import {
  bodyOf, clientIpHash, csrfTokenFor, newRequestId, rateLimit, readCookies, safeEqual, secureJson,
} from '../server/httpSecurity.js';

const COOKIE = 'tc_admin_session';
const MAX_AGE = 60 * 60 * 8;

function signature(expires, secret) {
  return createHmac('sha256', secret).update(`token-city-admin:${expires}`).digest('hex');
}

function sessionValue(request) {
  return String(readCookies(request)[COOKIE] || '');
}

function sessionValid(request, secret) {
  const [expires, provided] = sessionValue(request).split('.');
  return Number(expires) > Math.floor(Date.now() / 1000) && safeEqual(provided, signature(expires, secret));
}

export function adminSessionValid(request) {
  const secret = process.env.TOKEN_CITY_ADMIN_SESSION_SECRET;
  return Boolean(secret && sessionValid(request, secret));
}

/** Session facts an authorized admin endpoint needs: never exported to a page. */
export function adminContext(request) {
  const secret = process.env.TOKEN_CITY_ADMIN_SESSION_SECRET;
  if (!secret || !sessionValid(request, secret)) return null;
  const value = sessionValue(request);
  return {
    sessionValue: value,
    csrfToken: csrfTokenFor(value, secret),
    // The operator identity is the session, not a guessable name; the audit log
    // stores this stable hash rather than the session token itself.
    adminUserId: `admin_${createHmac('sha256', secret).update(value).digest('hex').slice(0, 16)}`,
    secret,
  };
}

export default async function handler(request, response) {
  const password = process.env.TOKEN_CITY_ADMIN_PASSWORD;
  const secret = process.env.TOKEN_CITY_ADMIN_SESSION_SECRET;
  if (!password || !secret) return secureJson(response, 503, { error: 'Admin access is not configured' }, { noindex: true });

  if (request.method === 'GET') {
    const context = adminContext(request);
    return secureJson(response, context ? 200 : 401, {
      authenticated: Boolean(context),
      csrfToken: context?.csrfToken || null,
    }, { noindex: true });
  }
  if (request.method !== 'POST') return secureJson(response, 405, { error: 'Method not allowed' }, { noindex: true });

  const body = bodyOf(request);
  if (body.action === 'logout') {
    response.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    return secureJson(response, 200, { authenticated: false }, { noindex: true });
  }

  const ipHash = clientIpHash(request, secret);
  const limit = rateLimit(`admin-login:${ipHash}`, { limit: 8, windowMs: 10 * 60_000 });
  if (!limit.allowed) {
    return secureJson(response, 429, {
      error: 'Too many sign-in attempts. Wait a few minutes and try again.',
      requestId: newRequestId(),
    }, { noindex: true });
  }
  if (!safeEqual(body.password, password)) {
    return secureJson(response, 401, { error: 'Wrong password' }, { noindex: true });
  }
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE;
  const token = `${expires}.${signature(expires, secret)}`;
  response.setHeader('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`);
  return secureJson(response, 200, { authenticated: true, csrfToken: csrfTokenFor(token, secret) }, { noindex: true });
}
