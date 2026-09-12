// BlockchainAdapter boundary (task8 §5).
//
// Game systems talk to this interface only. They never import an RPC client,
// an ABI or a chain literal, so a future network is a new adapter rather than a
// rewrite of the deposit and withdrawal services.

import { createPublicClient, defineChain, hexToString, http, decodeEventLog } from 'viem';
import { ERC20_ABI, ERC20_BYTES32_METADATA_ABI, DEPOSIT_VAULT_ABI, DEPOSITED_EVENT } from './abi.js';
import { normalizeEvmAddress, sameAddress, toBigInt, fromRawAmount, ZERO_ADDRESS } from './evm.js';
import { UNSUPPORTED_TOKEN_REASONS } from './tokenConfig.js';
import {
  networkByType, networkByChainId, explorerAddressUrl, explorerTokenUrl, explorerTxUrl, walletNetworkMetadata,
} from './networks.js';

function viemChain(network) {
  return defineChain({
    id: network.chainId,
    name: network.networkName,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: { default: { http: [network.publicRpcUrl] } },
    blockExplorers: { default: { name: 'Blockscout', url: network.explorerBaseUrl } },
  });
}

export class RobinhoodChainAdapter {
  /**
   * @param {object} options
   * @param {string} options.networkType  'mainnet' | 'testnet'
   * @param {string} [options.rpcUrl]     production provider endpoint; falls back
   *                                      to the public rate-limited RPC, which is
   *                                      acceptable for development only.
   */
  constructor({ networkType, rpcUrl = '', timeoutMs = 15_000, retryCount = 2 } = {}) {
    this.network = networkByType(networkType);
    this.rpcUrl = String(rpcUrl || '').trim() || this.network.publicRpcUrl;
    this.usingPublicRpc = this.rpcUrl === this.network.publicRpcUrl;
    this.client = createPublicClient({
      chain: viemChain(this.network),
      transport: http(this.rpcUrl, { timeout: timeoutMs, retryCount, batch: false }),
    });
  }

  getChainId() { return this.network.chainId; }

  getNetworkMetadata() { return { ...this.network }; }

  getWalletNetworkMetadata() { return walletNetworkMetadata(this.network.networkType); }

  validateAddress(address) {
    try { return { ok: true, address: normalizeEvmAddress(address) }; }
    catch (error) { return { ok: false, reason: error.message }; }
  }

  /** Fails loudly when the configured endpoint is not the expected chain. */
  async assertChainId() {
    const reported = await this.client.getChainId();
    if (Number(reported) !== this.network.chainId) {
      throw new Error(`The configured RPC reports chain id ${reported} but ${this.network.networkName} is ${this.network.chainId}`);
    }
    return reported;
  }

  async getNativeBalance(wallet) {
    const address = normalizeEvmAddress(wallet, { label: 'Wallet address' });
    const raw = await this.client.getBalance({ address });
    return { rawAmount: raw.toString(), decimals: 18, displayAmount: fromRawAmount(raw, 18) };
  }

  async hasContractCode(address) {
    const code = await this.client.getCode({ address: normalizeEvmAddress(address) });
    return Boolean(code && code !== '0x');
  }

  async #metadataString(address, functionName) {
    try {
      return String(await this.client.readContract({ address, abi: ERC20_ABI, functionName }));
    } catch {
      // bytes32 metadata is a legacy but real ERC-20 variant.
      const value = await this.client.readContract({ address, abi: ERC20_BYTES32_METADATA_ABI, functionName });
      return hexToString(value, { size: 32 }).replace(/\0+$/, '');
    }
  }

  /** Full token validation used by the admin page (§7.3). */
  async getTokenMetadata(tokenAddress) {
    const address = normalizeEvmAddress(tokenAddress, { label: 'Token contract address' });
    await this.assertChainId();
    if (!await this.hasContractCode(address)) {
      const error = new Error(UNSUPPORTED_TOKEN_REASONS.NO_CODE);
      error.code = 'NO_CODE';
      throw error;
    }
    let name;
    let symbol;
    try {
      [name, symbol] = await Promise.all([
        this.#metadataString(address, 'name'),
        this.#metadataString(address, 'symbol'),
      ]);
    } catch (error) {
      const failure = new Error(`${UNSUPPORTED_TOKEN_REASONS.METADATA_REVERT} (${error.shortMessage || error.message})`);
      failure.code = 'METADATA_REVERT';
      throw failure;
    }
    const [decimals, totalSupply] = await Promise.all([
      this.client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
      this.client.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }),
    ]);
    const scale = Number(decimals);
    if (!Number.isInteger(scale) || scale < 0 || scale > 36) {
      const error = new Error(UNSUPPORTED_TOKEN_REASONS.DECIMALS_OUT_OF_RANGE);
      error.code = 'DECIMALS_OUT_OF_RANGE';
      throw error;
    }
    // A read-only balanceOf probe on the zero address proves the standard entry
    // point answers without moving anything.
    let probeOk = true;
    try { await this.client.readContract({ address, abi: ERC20_ABI, functionName: 'balanceOf', args: [ZERO_ADDRESS] }); }
    catch { probeOk = false; }
    if (!probeOk) {
      const error = new Error(UNSUPPORTED_TOKEN_REASONS.BALANCE_REVERT);
      error.code = 'BALANCE_REVERT';
      throw error;
    }
    return {
      chainId: this.network.chainId,
      address,
      name,
      symbol,
      decimals: scale,
      totalSupplyRaw: totalSupply.toString(),
      totalSupplyDisplay: fromRawAmount(totalSupply, scale),
      explorerUrl: explorerTokenUrl(this.network, address),
    };
  }

  async getTokenBalance(tokenAddress, wallet) {
    const address = normalizeEvmAddress(tokenAddress, { label: 'Token contract address' });
    const owner = normalizeEvmAddress(wallet, { label: 'Wallet address' });
    const [raw, decimals] = await Promise.all([
      this.client.readContract({ address, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }),
      this.client.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }),
    ]);
    return { rawAmount: raw.toString(), decimals: Number(decimals), displayAmount: fromRawAmount(raw, Number(decimals)) };
  }

  async getAllowance(tokenAddress, owner, spender) {
    const raw = await this.client.readContract({
      address: normalizeEvmAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [normalizeEvmAddress(owner), normalizeEvmAddress(spender)],
    });
    return raw.toString();
  }

  /** Unsigned request the wallet is asked to sign. No key ever reaches here. */
  buildApprovalRequest({ tokenAddress, spender, rawAmount }) {
    return {
      chainId: this.network.chainId,
      address: normalizeEvmAddress(tokenAddress),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [normalizeEvmAddress(spender), toBigInt(rawAmount)],
    };
  }

  buildDepositRequest({ depositContractAddress, tokenAddress, rawAmount, depositIdHash }) {
    return {
      chainId: this.network.chainId,
      address: normalizeEvmAddress(depositContractAddress),
      abi: DEPOSIT_VAULT_ABI,
      functionName: 'deposit',
      args: [normalizeEvmAddress(tokenAddress), toBigInt(rawAmount), depositIdHash],
    };
  }

  /**
   * Withdrawals leave the vault through its own authorized entry point rather
   * than a bare ERC-20 transfer from a hot wallet: the contract enforces the
   * withdrawer role and rejects a replayed withdrawalId, so a retried job can
   * never send the same amount twice.
   */
  buildWithdrawal({ depositContractAddress, tokenAddress, to, rawAmount, withdrawalIdHash }) {
    return {
      chainId: this.network.chainId,
      address: normalizeEvmAddress(depositContractAddress, { label: 'Deposit contract address' }),
      abi: DEPOSIT_VAULT_ABI,
      functionName: 'withdrawTo',
      args: [
        normalizeEvmAddress(tokenAddress),
        normalizeEvmAddress(to, { label: 'Destination wallet' }),
        toBigInt(rawAmount),
        withdrawalIdHash,
      ],
    };
  }

  async getTransactionReceipt(txHash) {
    try { return await this.client.getTransactionReceipt({ hash: txHash }); }
    catch { return null; }
  }

  /** Decoded `Deposited` logs from one transaction receipt. */
  decodeDepositedEvents(receipt, depositContractAddress) {
    const events = [];
    for (const log of receipt?.logs || []) {
      if (!sameAddress(log.address, depositContractAddress)) continue;
      let decoded;
      try { decoded = decodeEventLog({ abi: [DEPOSITED_EVENT], data: log.data, topics: log.topics }); }
      catch { continue; }
      if (decoded.eventName !== 'Deposited') continue;
      events.push({
        address: log.address,
        logIndex: Number(log.logIndex),
        removed: Boolean(log.removed),
        blockNumber: log.blockNumber?.toString?.() ?? String(log.blockNumber),
        blockHash: log.blockHash,
        transactionHash: log.transactionHash,
        wallet: decoded.args.wallet,
        token: decoded.args.token,
        depositId: decoded.args.depositId,
        amount: decoded.args.amount.toString(),
      });
    }
    return events;
  }

  async getDepositEvent(txHash, logIndex, depositContractAddress) {
    const receipt = await this.getTransactionReceipt(txHash);
    if (!receipt) return null;
    return this.decodeDepositedEvents(receipt, depositContractAddress)
      .find((event) => Number(event.logIndex) === Number(logIndex)) || null;
  }

  /** Safe/finalized heads, with a graceful fallback when the tags are absent. */
  async getFinalityHeads() {
    const read = async (blockTag) => {
      try { return (await this.client.getBlock({ blockTag })).number; }
      catch { return null; }
    };
    const [latest, safe, finalized] = await Promise.all([read('latest'), read('safe'), read('finalized')]);
    return {
      latestBlockNumber: latest === null ? null : latest.toString(),
      safeBlockNumber: safe === null ? null : safe.toString(),
      finalizedBlockNumber: finalized === null ? null : finalized.toString(),
      tagsSupported: safe !== null || finalized !== null,
    };
  }

  /** Re-read a block hash to detect a reorganization (§11.7). */
  async getCanonicalBlockHash(blockNumber) {
    try { return (await this.client.getBlock({ blockNumber: toBigInt(blockNumber) })).hash; }
    catch { return null; }
  }

  async getFinalityStatus(blockNumber, blockHash) {
    const [heads, canonicalHash] = await Promise.all([
      this.getFinalityHeads(),
      this.getCanonicalBlockHash(blockNumber),
    ]);
    return {
      ...heads,
      canonicalBlockHash: canonicalHash,
      reorged: Boolean(blockHash && canonicalHash && canonicalHash.toLowerCase() !== String(blockHash).toLowerCase()),
    };
  }

  async getVaultState({ depositContractAddress, tokenAddress }) {
    const address = normalizeEvmAddress(depositContractAddress);
    const [paused, supported] = await Promise.all([
      this.client.readContract({ address, abi: DEPOSIT_VAULT_ABI, functionName: 'paused' }).catch(() => null),
      this.client.readContract({
        address, abi: DEPOSIT_VAULT_ABI, functionName: 'supportedToken', args: [normalizeEvmAddress(tokenAddress)],
      }).catch(() => null),
    ]);
    return { paused, supportedToken: supported };
  }

  getExplorerUrl(kind, value) {
    if (kind === 'tx') return explorerTxUrl(this.network, value);
    if (kind === 'token') return explorerTokenUrl(this.network, value);
    return explorerAddressUrl(this.network, value);
  }
}

export function adapterForChainId(chainId, rpcUrl) {
  return new RobinhoodChainAdapter({ networkType: networkByChainId(chainId).networkType, rpcUrl });
}
