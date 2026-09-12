// Contract interfaces used by the game (task8 §6, §11.1, §14).

export const ERC20_ABI = Object.freeze([
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'transferFrom',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
]);

// Some ERC-20 deployments expose bytes32 metadata instead of string. The
// validator retries with this interface before rejecting a token outright.
export const ERC20_BYTES32_METADATA_ABI = Object.freeze([
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
]);

export const DEPOSIT_VAULT_ABI = Object.freeze([
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'depositId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'depositUsed',
    stateMutability: 'view',
    inputs: [{ name: 'depositId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'withdrawTo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'withdrawalId', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawalUsed',
    stateMutability: 'view',
    inputs: [{ name: 'withdrawalId', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  {
    type: 'function',
    name: 'supportedToken',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'depositId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      { name: 'wallet', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'withdrawalId', type: 'bytes32', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
]);

export const DEPOSITED_EVENT = Object.freeze(
  DEPOSIT_VAULT_ABI.find((entry) => entry.type === 'event' && entry.name === 'Deposited'),
);
export const WITHDRAWN_EVENT = Object.freeze(
  DEPOSIT_VAULT_ABI.find((entry) => entry.type === 'event' && entry.name === 'Withdrawn'),
);
