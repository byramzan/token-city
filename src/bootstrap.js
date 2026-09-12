import { Buffer } from 'buffer';

// WalletConnect and some EIP-1193 wallet SDKs still reference Node's Buffer in
// browser code paths. Install the browser implementation before loading the
// application so a lazily imported connector cannot fail on first use. The
// retained Solana modules depend on the same shim.
globalThis.Buffer ||= Buffer;

import('./main.js');
