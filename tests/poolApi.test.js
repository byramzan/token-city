import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { parsePoolEnvironment, publicPoolSummary } from '../api/pool.js';

test('player-funded pool manifest exposes its address without exposing the signer', () => {
  const pool = Keypair.generate();
  const vault = {
    status: 'ready',
    network: 'devnet',
    rpc: 'https://api.devnet.solana.com',
    mint: Keypair.generate().publicKey.toBase58(),
    decimals: 6,
    pool: { address: pool.publicKey.toBase58(), secretKey: [...pool.secretKey] },
  };
  const encoded = Buffer.from(JSON.stringify(vault)).toString('base64');
  const parsed = parsePoolEnvironment(encoded);
  const summary = publicPoolSummary(parsed);

  assert.equal(summary.poolWallet, pool.publicKey.toBase58());
  assert.equal(summary.network, 'devnet');
  assert.equal(JSON.stringify(summary).includes('secretKey'), false);
});

test('pool configuration rejects a mismatched address and signer', () => {
  const signer = Keypair.generate();
  const vault = {
    status: 'ready',
    network: 'devnet',
    mint: Keypair.generate().publicKey.toBase58(),
    pool: { address: Keypair.generate().publicKey.toBase58(), secretKey: [...signer.secretKey] },
  };
  const encoded = Buffer.from(JSON.stringify(vault)).toString('base64');
  assert.throws(() => parsePoolEnvironment(encoded), /does not match/);
});
