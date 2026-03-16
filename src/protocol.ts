/**
 * USDT0 Protocol Constants for EVM → Tron Multihop
 *
 * Chain configs, ABIs, and helpers for bridging from an EVM chain
 * through Arbitrum (hub) to Tron via LayerZero Legacy Mesh.
 */

import {http, createPublicClient, createWalletClient, getAddress, type Chain, type PublicClient, type WalletClient, type Address} from 'viem';
import {arbitrum, berachain} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {Options} from '@layerzerolabs/lz-v2-utilities';
import {createHash} from 'crypto';
import bs58 from 'bs58';

// ============================================================================
// CHAIN CONFIGS
// ============================================================================

export const CHAINS = {
  bera: {
    chain: berachain,
    eid: 30362,
    oftProxy: '0x3Dc96399109df5ceb2C226664A086140bD0379cB' as Address,
    token: '0x779Ded0c9e1022225f8E0630b35a9b54bE713736' as Address,
    nativeCurrency: 'BERA',
  },
  arbitrum: {
    chain: arbitrum,
    eid: 30110,
    oftProxy: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92' as Address,
    token: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address,
    nativeCurrency: 'ETH',
  },
} as const;

export type ChainKey = keyof typeof CHAINS;

/** Arbitrum hub config for multihop */
export const ARBITRUM_HUB = {
  eid: 30110,
  /** The proxy OFT on Arbitrum (for proxy mesh destinations) */
  oftProxy: '0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92' as Address,
  /** The native OFT on Arbitrum (for legacy/native mesh destinations like Tron, Solana, TON) */
  oftNative: '0x77652D5aba086137b595875263FC200182919B92' as Address,
  multiHopComposer: '0x759BA420bF1ded1765F18C2DC3Fc57A1964A2Ad1' as Address,
};

/** Tron destination config */
export const TRON_CONFIG = {
  eid: 30420,
};

// ============================================================================
// CONTRACT ABIS
// ============================================================================

export const OFT_ABI = [
  {
    name: 'quoteOFT',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'sendParam', type: 'tuple', components: [
      {name: 'dstEid', type: 'uint32'},
      {name: 'to', type: 'bytes32'},
      {name: 'amountLD', type: 'uint256'},
      {name: 'minAmountLD', type: 'uint256'},
      {name: 'extraOptions', type: 'bytes'},
      {name: 'composeMsg', type: 'bytes'},
      {name: 'oftCmd', type: 'bytes'},
    ]}],
    outputs: [
      {name: 'oftLimit', type: 'tuple', components: [{name: 'minAmountLD', type: 'uint256'}, {name: 'maxAmountLD', type: 'uint256'}]},
      {name: 'oftFeeDetails', type: 'tuple[]', components: [{name: 'feeAmountLD', type: 'int256'}, {name: 'description', type: 'string'}]},
      {name: 'oftReceipt', type: 'tuple', components: [{name: 'amountSentLD', type: 'uint256'}, {name: 'amountReceivedLD', type: 'uint256'}]},
    ],
  },
  {
    name: 'quoteSend',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {name: 'sendParam', type: 'tuple', components: [
        {name: 'dstEid', type: 'uint32'},
        {name: 'to', type: 'bytes32'},
        {name: 'amountLD', type: 'uint256'},
        {name: 'minAmountLD', type: 'uint256'},
        {name: 'extraOptions', type: 'bytes'},
        {name: 'composeMsg', type: 'bytes'},
        {name: 'oftCmd', type: 'bytes'},
      ]},
      {name: 'payInLzToken', type: 'bool'},
    ],
    outputs: [{name: 'msgFee', type: 'tuple', components: [{name: 'nativeFee', type: 'uint256'}, {name: 'lzTokenFee', type: 'uint256'}]}],
  },
  {
    name: 'send',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {name: 'sendParam', type: 'tuple', components: [
        {name: 'dstEid', type: 'uint32'},
        {name: 'to', type: 'bytes32'},
        {name: 'amountLD', type: 'uint256'},
        {name: 'minAmountLD', type: 'uint256'},
        {name: 'extraOptions', type: 'bytes'},
        {name: 'composeMsg', type: 'bytes'},
        {name: 'oftCmd', type: 'bytes'},
      ]},
      {name: 'fee', type: 'tuple', components: [{name: 'nativeFee', type: 'uint256'}, {name: 'lzTokenFee', type: 'uint256'}]},
      {name: 'refundAddress', type: 'address'},
    ],
    outputs: [
      {name: 'msgReceipt', type: 'tuple', components: [{name: 'guid', type: 'bytes32'}, {name: 'nonce', type: 'uint64'}, {name: 'fee', type: 'tuple', components: [{name: 'nativeFee', type: 'uint256'}, {name: 'lzTokenFee', type: 'uint256'}]}]},
      {name: 'oftReceipt', type: 'tuple', components: [{name: 'amountSentLD', type: 'uint256'}, {name: 'amountReceivedLD', type: 'uint256'}]},
    ],
  },
] as const;

export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{name: 'spender', type: 'address'}, {name: 'amount', type: 'uint256'}],
    outputs: [{name: '', type: 'bool'}],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'owner', type: 'address'}, {name: 'spender', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{name: 'account', type: 'address'}],
    outputs: [{name: '', type: 'uint256'}],
  },
] as const;

// ============================================================================
// TRON ADDRESS ENCODING
// ============================================================================

export class InvalidAddressError extends Error {
  constructor(address: string) {
    super(`Invalid Tron address: ${address}`);
    this.name = 'InvalidAddressError';
  }
}

function sha256(data: Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

function isValidTronBase58(address: string): boolean {
  if (!address.startsWith('T')) return false;
  try {
    const decoded = bs58.decode(address);
    if (decoded.length !== 25) return false;
    if (decoded[0] !== 0x41) return false;
    // Verify checksum: double SHA256 of first 21 bytes, first 4 bytes = checksum
    const payload = decoded.slice(0, 21);
    const checksum = sha256(sha256(payload)).subarray(0, 4);
    return Buffer.from(decoded.slice(21)).equals(checksum);
  } catch {
    return false;
  }
}

function isValidEvmHex(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

/**
 * Convert a Tron address to its 20-byte EVM hex representation.
 *
 * Accepts Base58check (T...) or 0x-prefixed EVM hex.
 * For Base58check: decodes, validates checksum, strips 0x41 prefix.
 * For EVM hex: validates length and returns checksummed.
 *
 * @throws {InvalidAddressError} if the address is invalid
 */
export function toHexAddress(address: string): `0x${string}` {
  if (address.startsWith('T')) {
    if (!isValidTronBase58(address)) {
      throw new InvalidAddressError(address);
    }
    const decoded = bs58.decode(address);
    const hex = Buffer.from(decoded.slice(1, 21)).toString('hex');
    return `0x${hex}` as `0x${string}`;
  }

  if (address.startsWith('0x')) {
    if (!isValidEvmHex(address)) {
      throw new InvalidAddressError(address);
    }
    // Return EIP-55 checksummed address
    return getAddress(address as Address);
  }

  throw new InvalidAddressError(address);
}

/**
 * Convert a Tron address to bytes32 for LayerZero.
 *
 * Tron addresses have a 0x41 network prefix that MUST be stripped.
 * The OFT contract validates that the upper 12 bytes of the bytes32 are all zero:
 *   require(to == bytes32(uint256(uint160(address(uint160(uint256(to)))))))
 *
 * If 0x41 is included, the round-trip check fails and the token credit is silently dropped.
 */
export function tronAddressToBytes32(tronAddress: string): `0x${string}` {
  const hex = toHexAddress(tronAddress);
  return `0x${hex.slice(2).padStart(64, '0')}` as `0x${string}`;
}

/**
 * Convert an EVM address to bytes32 (left-pad with zeros).
 */
export function addressToBytes32(address: Address): `0x${string}` {
  return `0x${address.slice(2).padStart(64, '0')}` as `0x${string}`;
}

// ============================================================================
// HELPERS
// ============================================================================

/** Build LayerZero execution options */
export function buildOptions(gasLimit: number = 200_000): `0x${string}` {
  return Options.newOptions().addExecutorLzReceiveOption(gasLimit, 0).toHex() as `0x${string}`;
}

/** Build multihop options with compose for the second hop */
export function buildMultihopOptions(hopNativeFee: bigint): `0x${string}` {
  return Options.newOptions()
    .addExecutorLzReceiveOption(200_000, 0)
    .addExecutorComposeOption(0, 500_000, (hopNativeFee * 11n) / 10n)
    .toHex() as `0x${string}`;
}

/** Create a public client for reading */
export function getPublicClient(chainKey: ChainKey): PublicClient {
  const config = CHAINS[chainKey];
  return createPublicClient({
    chain: config.chain,
    transport: http(),
  });
}

/** Create a wallet client for writing */
export function getWalletClient(chainKey: ChainKey, privateKey: `0x${string}`): WalletClient {
  const config = CHAINS[chainKey];
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: config.chain,
    transport: http(),
  });
}
