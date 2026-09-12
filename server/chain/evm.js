// EVM address and raw-amount primitives (task8 §3, §6.2).
//
// Rules enforced here:
//   * an EVM address is 0x + 40 hex characters, never Base58;
//   * the zero address is never a valid token, vault or recipient;
//   * display uses the EIP-55 checksum form, uniqueness uses the lowercase key;
//   * on-chain amounts are BigInt raw units, never JavaScript numbers.

// keccak comes straight from @noble/hashes rather than a wallet SDK: this file
// must stay usable in the browser, in a Vercel Function and inside a Convex
// query runtime without pulling an RPC client behind it.
import { keccak_256 } from '@noble/hashes/sha3.js';

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function keccakHex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = keccak_256(bytes);
  let out = '0x';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function isEvmAddress(value) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(value ?? '').trim());
}

/** EIP-55 checksum, implemented locally so no chain client is required. */
export function toChecksumAddress(lowercase) {
  const body = lowercase.slice(2);
  const hash = keccakHex(body).slice(2);
  let out = '0x';
  for (let i = 0; i < body.length; i += 1) {
    out += parseInt(hash[i], 16) >= 8 ? body[i].toUpperCase() : body[i];
  }
  return out;
}

/** Checksummed display form. Throws with a user-readable reason. */
export function normalizeEvmAddress(value, { allowZero = false, label = 'Address' } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error(`${label} is required`);
  if (raw.startsWith('0X')) throw new Error(`${label} must start with a lowercase 0x prefix`);
  if (!isEvmAddress(raw)) throw new Error(`${label} is not a valid EVM address (expected 0x and 40 hex characters)`);
  const checksummed = toChecksumAddress(raw.toLowerCase());
  if (!allowZero && checksummed.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} must not be the zero address`);
  return checksummed;
}

/** Lowercase comparison key. Never shown to a user; display uses the checksum. */
export function addressKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function sameAddress(left, right) {
  return Boolean(left) && Boolean(right) && addressKey(left) === addressKey(right);
}

export function isTransactionHash(value) {
  return /^0x[0-9a-fA-F]{64}$/.test(String(value ?? '').trim());
}

export function normalizeTransactionHash(value) {
  const raw = String(value ?? '').trim();
  if (!isTransactionHash(raw)) throw new Error('Transaction hash must be 0x and 64 hex characters');
  return raw.toLowerCase();
}

/**
 * Human decimal string -> raw integer units. No floating point is involved:
 * the string is split on the decimal point and padded, so 0.1 with 18 decimals
 * is exact. Rejects negative, empty, exponent and over-precise input.
 */
export function toRawAmount(displayAmount, decimals) {
  const scale = Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 36) throw new Error('Token decimals are out of range');
  const raw = String(displayAmount ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new Error('Token amount must be a positive decimal number');
  const [whole, rawFraction = ''] = raw.split('.');
  // Trailing zeros beyond the token precision carry no value, so "1.000000" is
  // accepted for a 2-decimal token while "1.005" is still rejected.
  const fraction = rawFraction.length > scale && !/[1-9]/.test(rawFraction.slice(scale))
    ? rawFraction.slice(0, scale)
    : rawFraction;
  if (fraction.length > scale) throw new Error(`This token supports at most ${scale} decimal places`);
  const units = BigInt(whole + fraction.padEnd(scale, '0'));
  if (units <= 0n) throw new Error('Token amount must be greater than zero');
  return units;
}

/** Raw integer units -> exact decimal string. Trailing zeros are trimmed. */
export function fromRawAmount(rawAmount, decimals) {
  const scale = Number(decimals);
  if (!Number.isInteger(scale) || scale < 0 || scale > 36) throw new Error('Token decimals are out of range');
  const units = toBigInt(rawAmount);
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const whole = digits.slice(0, digits.length - scale) || '0';
  const fraction = scale ? digits.slice(digits.length - scale).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Accepts BigInt, decimal string or 0x string. Never accepts a float. */
export function toBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Raw token amounts must not be JavaScript floating point numbers');
    return BigInt(value);
  }
  const raw = String(value ?? '').trim();
  if (/^-?\d+$/.test(raw)) return BigInt(raw);
  if (/^0x[0-9a-fA-F]+$/.test(raw)) return BigInt(raw);
  throw new Error('Raw token amount is not an integer');
}

/** Storage form: raw stays a string so JSON and Convex never lose precision. */
export function rawAmountRecord(rawAmount, decimals) {
  const units = toBigInt(rawAmount);
  return {
    rawAmount: units.toString(),
    tokenDecimals: Number(decimals),
    displayAmount: fromRawAmount(units, decimals),
  };
}

/** Group a display amount for the UI without losing a single digit. */
export function formatTokenAmount(rawAmount, decimals, { locale = 'en-US', maximumFractionDigits = 6 } = {}) {
  const exact = fromRawAmount(rawAmount, decimals);
  const [whole, fraction = ''] = exact.split('.');
  const grouped = Number(whole).toLocaleString(locale);
  if (!fraction) return grouped;
  const shown = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '');
  const truncated = fraction.length > shown.length && fraction.slice(shown.length).replace(/0+$/, '').length > 0;
  return shown ? `${grouped}.${shown}${truncated ? '…' : ''}` : grouped;
}
