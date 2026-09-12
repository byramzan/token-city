import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';

import { normalizeContractAddress, normalizePublicConfig } from '../server/publicConfig.js';

test('public C/A is canonicalized and empty configuration renders the placeholder state', () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.equal(normalizeContractAddress(`  ${address}  `), address);
  assert.deepEqual(normalizePublicConfig(null), { contractAddress: '', updatedAt: 0 });
  assert.throws(() => normalizeContractAddress('not-a-solana-address'), /valid Solana address/);
});

test('stored public configuration accepts serialized Redis values', () => {
  const address = Keypair.generate().publicKey.toBase58();
  assert.deepEqual(normalizePublicConfig(JSON.stringify({ contractAddress: address, updatedAt: 123 })), {
    contractAddress: address,
    updatedAt: 123,
  });
});
