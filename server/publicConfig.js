import { PublicKey } from '@solana/web3.js';

export const PUBLIC_CONFIG_KEY = 'token-city:public-config:v1';

export function normalizeContractAddress(value) {
  const address = String(value || '').trim();
  if (!address) return '';
  try { return new PublicKey(address).toBase58(); }
  catch { throw new Error('C/A must be a valid Solana address'); }
}

export function normalizePublicConfig(value) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  return {
    contractAddress: normalizeContractAddress(source?.contractAddress || ''),
    updatedAt: Math.max(0, Math.trunc(Number(source?.updatedAt) || 0)),
  };
}
