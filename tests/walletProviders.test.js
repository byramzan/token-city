import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WALLET_PROVIDERS,
  connectProvider,
  isSolanaStandardWallet,
  providerCatalog,
  safeWalletIcon,
  walletErrorKind,
  walletMatchesProvider,
  withWalletOperationLock,
} from '../src/walletProviders.js';

function standardWallet(name = 'Phantom') {
  return {
    name,
    icon: 'data:image/png;base64,AA==',
    features: {
      'standard:connect': {},
      'standard:events': {},
      'solana:signTransaction': {},
    },
  };
}

test('Wallet Standard detection accepts Solana signers and rejects non-Solana wallets', () => {
  assert.equal(isSolanaStandardWallet(standardWallet()), true);
  assert.equal(isSolanaStandardWallet({
    name: 'EVM only',
    features: { 'standard:connect': {}, 'standard:events': {}, 'ethereum:signTransaction': {} },
  }), false);
});

test('installed wallet names match their configured Token City provider', () => {
  const phantom = WALLET_PROVIDERS.find((provider) => provider.id === 'phantom');
  const coinbase = WALLET_PROVIDERS.find((provider) => provider.id === 'coinbase');
  assert.equal(walletMatchesProvider(standardWallet('Phantom'), phantom), true);
  assert.equal(walletMatchesProvider(standardWallet('Coinbase Wallet'), coinbase), true);
  assert.equal(walletMatchesProvider(standardWallet('Backpack'), phantom), false);
});

test('wallet icons accept image sources but reject executable URLs', () => {
  assert.equal(safeWalletIcon('data:image/png;base64,AA=='), 'data:image/png;base64,AA==');
  assert.equal(safeWalletIcon('https://example.com/wallet.svg'), 'https://example.com/wallet.svg');
  assert.equal(safeWalletIcon('javascript:alert(1)', 'fallback.svg'), 'fallback.svg');
  assert.equal(safeWalletIcon('data:text/html;base64,AA==', 'fallback.svg'), 'fallback.svg');
});

test('legacy Phantom connects in place without opening a download page', async () => {
  const originalWindow = globalThis.window;
  let connected = 0;
  globalThis.window = {
    phantom: {
      solana: {
        isPhantom: true,
        publicKey: { toString: () => 'PhantomWalletAddress' },
        connect: async () => { connected += 1; },
      },
    },
  };
  try {
    const phantom = providerCatalog().find((provider) => provider.id === 'phantom');
    assert.equal(phantom.installed, true);
    assert.equal(phantom.source, 'legacy');
    const result = await connectProvider('phantom');
    assert.equal(result.address, 'PhantomWalletAddress');
    assert.equal(connected, 1);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('wallet extension failures are separated from normal user rejection', () => {
  assert.equal(walletErrorKind(new Error('Extension context invalidated.')), 'extension-stale');
  assert.equal(walletErrorKind(new Error('Failed to send message to service worker')), 'extension-stale');
  assert.equal(walletErrorKind(new Error('User rejected the request')), 'user-rejected');
  assert.equal(walletErrorKind(new Error('unrelated failure')), 'unknown');
});

test('a second wallet request in the same tab is rejected while the first is pending', async () => {
  let markStarted;
  let finish;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const pending = withWalletOperationLock(() => new Promise((resolve) => {
    finish = resolve;
    markStarted();
  }));
  await started;
  await assert.rejects(withWalletOperationLock(async () => 'second'), /wallet-busy/);
  finish('first');
  assert.equal(await pending, 'first');
});

test('plain EVM MetaMask is not presented as a Solana wallet', () => {
  const originalWindow = globalThis.window;
  globalThis.window = { ethereum: { isMetaMask: true } };
  try {
    const metamask = providerCatalog().find((provider) => provider.id === 'metamask');
    assert.equal(metamask.installed, false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
