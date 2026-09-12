// Wallet ownership proof (task8 §9.6).
//
// Sign-In with Ethereum semantics: the server issues a one-time challenge, the
// wallet signs the exact text, the server checks signature, nonce, domain,
// chain id, expiry and replay state. The user never uploads a key.

import { normalizeEvmAddress, sameAddress } from './evm.js';

export const CHALLENGE_TTL_MS = 5 * 60_000;

export const WALLET_STATEMENT =
  'Link this wallet to your Token City account. This signature proves ownership. '
  + 'It authorizes no transfer and Token City will never ask for your recovery phrase or private key.';

/** Build the exact EIP-4361 message text that must be signed. */
export function buildChallengeMessage(challenge) {
  const lines = [
    `${challenge.domain} wants you to sign in with your Ethereum account:`,
    challenge.walletAddress,
    '',
    challenge.statement || WALLET_STATEMENT,
    '',
    `URI: ${challenge.uri}`,
    `Version: ${challenge.version || '1'}`,
    `Chain ID: ${challenge.chainId}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${new Date(challenge.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(challenge.expiresAt).toISOString()}`,
    `Request ID: ${challenge.requestId}`,
  ];
  return lines.join('\n');
}

/** Create the challenge record. `randomHex` is injected so tests are stable. */
export function createChallenge({
  domain, uri, walletAddress, chainId, accountId, randomHex, now = Date.now(), ttlMs = CHALLENGE_TTL_MS,
}) {
  const address = normalizeEvmAddress(walletAddress, { label: 'Wallet address' });
  if (!domain) throw new Error('Challenge domain is required');
  if (!Number.isInteger(Number(chainId))) throw new Error('Challenge chain id is required');
  const challenge = {
    domain: String(domain),
    uri: String(uri || `https://${domain}`),
    walletAddress: address,
    statement: WALLET_STATEMENT,
    version: '1',
    chainId: Number(chainId),
    accountId: String(accountId),
    nonce: String(randomHex).slice(0, 32),
    requestId: `wc_${String(randomHex).slice(32, 56)}`,
    issuedAt: now,
    expiresAt: now + ttlMs,
    used: false,
  };
  return { ...challenge, message: buildChallengeMessage(challenge) };
}

/**
 * Field checks that do not need cryptography. The caller performs the actual
 * signature recovery (viem `verifyMessage`) and passes the result in.
 */
export function checkChallengeFields({ challenge, walletAddress, chainId, domain, now = Date.now() }) {
  if (!challenge) return 'This sign-in request is unknown. Request a new challenge.';
  if (challenge.used) return 'This sign-in request was already used. Request a new challenge.';
  if (!(challenge.expiresAt > now)) return 'This sign-in request expired. Request a new challenge.';
  if (!sameAddress(challenge.walletAddress, walletAddress)) return 'The signing wallet does not match the requested wallet.';
  if (Number(challenge.chainId) !== Number(chainId)) return 'The wallet is on a different chain than the challenge.';
  if (domain && challenge.domain !== domain) return 'The sign-in request was issued for a different site.';
  return null;
}
