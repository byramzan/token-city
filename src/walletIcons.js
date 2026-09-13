// Original wallet artwork, served with the app. Sources: docs/wallet-logo-sources.md.
const WALLET_ICONS = Object.freeze({
  robinhood: '/wallets/robinhood.jpg',
  metamask: '/wallets/metamask.svg',
  coinbase: '/wallets/coinbase.svg',
  okx: '/wallets/okx.png',
  phantom: '/wallets/phantom.svg',
  backpack: '/wallets/backpack.png',
  solflare: '/wallets/solflare.svg',
  jupiter: '/wallets/jupiter.svg',
  walletconnect: '/wallets/walletconnect.svg',
});

export function walletBrandIcon(providerId) {
  return WALLET_ICONS[providerId] || '';
}

export function isLocalWalletIcon(url) {
  return Object.values(WALLET_ICONS).includes(url);
}
