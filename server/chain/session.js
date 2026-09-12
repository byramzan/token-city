// Wallet session tokens (task8 §9.6, §20).
//
// The raw token exists only in the caller's browser. The database stores its
// hash, so a leaked table row cannot be replayed as a session.

import { keccakHex } from './evm.js';

export const SESSION_TTL_MS = 12 * 60 * 60_000;

export function sessionTokenHash(token) {
  return keccakHex(`token-city:chain-session:${String(token || '')}`);
}
