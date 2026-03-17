/**
 * USDT0 Multihop Bridge: EVM → Arbitrum → Tron
 *
 * Quotes and executes multihop cross-chain transfers from an EVM chain
 * to Tron via the Arbitrum MultiHopComposer.
 *
 * Flow:
 *   Source EVM --[LayerZero]--> Arbitrum (MultiHopComposer) --[LayerZero]--> Tron
 *
 * The source chain transaction sends to the MultiHopComposer on Arbitrum
 * with a composeMsg encoding the onward SendParams for the Tron hop.
 */

import {parseUnits, formatUnits, formatEther, encodeAbiParameters, type Address} from 'viem';
import {
  CHAINS,
  ChainKey,
  OFT_ABI,
  ERC20_ABI,
  ARBITRUM_HUB,
  TRON_CONFIG,
  tronAddressToBytes32,
  addressToBytes32,
  buildOptions,
  buildMultihopOptions,
  getPublicClient,
  getWalletClient,
} from './protocol.js';

// ============================================================================
// ABI FOR COMPOSE MESSAGE
// ============================================================================

const SEND_PARAMS_ABI = [
  {
    type: 'tuple',
    name: 'sendParams',
    components: [
      {name: 'dstEid', type: 'uint32'},
      {name: 'to', type: 'bytes32'},
      {name: 'amountLD', type: 'uint256'},
      {name: 'minAmountLD', type: 'uint256'},
      {name: 'extraOptions', type: 'bytes'},
      {name: 'composeMsg', type: 'bytes'},
      {name: 'oftCmd', type: 'bytes'},
    ],
  },
] as const;

// ============================================================================
// TYPES
// ============================================================================

export type QuoteResult = {
  nativeFee: bigint;
  lzTokenFee: bigint;
  hopNativeFee: bigint;
  amountSent: bigint;
  amountReceived: bigint;
};

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Quote the fee for the second hop (Arbitrum → Tron)
 * by calling quoteSend on the Arbitrum Native OFT contract.
 *
 * IMPORTANT: Tron is a "native mesh" destination, so we must use the
 * oftNative adapter on Arbitrum (not oftProxy). The oftProxy only has
 * peers for proxy mesh destinations (other EVM chains). The oftNative
 * adapter has the peer for Tron (EID 30420).
 */
async function quoteHopChainFee(hopSendParams: {
  dstEid: number;
  to: `0x${string}`;
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: `0x${string}`;
  composeMsg: `0x${string}`;
  oftCmd: `0x${string}`;
}): Promise<bigint> {
  const client = getPublicClient('arbitrum');

  const {nativeFee} = await client.readContract({
    address: ARBITRUM_HUB.oftNative,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [hopSendParams, false],
  });

  return nativeFee;
}

// ============================================================================
// QUOTE
// ============================================================================

/**
 * Get a fee quote for multihop bridging: Source EVM → Arbitrum → Tron.
 *
 * Steps:
 *   1. Build the hop chain SendParams (Arbitrum → Tron) with properly encoded Tron address
 *   2. Quote the hop chain fee by calling quoteSend on Arbitrum
 *   3. Build the compose message (ABI-encoded hop SendParams)
 *   4. Quote the source chain fee (with compose options that include hop fee)
 */
export async function quote(
  srcChain: ChainKey,
  tronRecipient: string,
  amountUsdt: number,
): Promise<QuoteResult> {
  const src = CHAINS[srcChain];
  const srcClient = getPublicClient(srcChain);
  const amountLD = parseUnits(amountUsdt.toString(), 6);

  // Encode Tron address: strip 0x41 prefix, left-pad to 32 bytes
  const tronBytes32 = tronAddressToBytes32(tronRecipient);
  console.log(`  Tron recipient bytes32: ${tronBytes32}`);

  // Step 1: Build hop chain SendParams (Arbitrum → Tron)
  const hopOptions = buildOptions();
  const hopSendParams = {
    dstEid: TRON_CONFIG.eid,
    to: tronBytes32,
    amountLD: amountLD,
    minAmountLD: (amountLD * 99n) / 100n, // 1% slippage for hop
    extraOptions: hopOptions,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: '0x' as `0x${string}`,
  };

  // Step 2: Quote the hop chain fee (Arbitrum → Tron)
  console.log('  Quoting hop chain fee (Arbitrum -> Tron)...');
  const hopNativeFee = await quoteHopChainFee(hopSendParams);
  console.log(`  Hop fee: ${formatEther(hopNativeFee)} ETH`);

  // Step 3: Build the compose message (ABI-encoded hop SendParams)
  const composeMsg = encodeAbiParameters(SEND_PARAMS_ABI, [hopSendParams]);

  // Step 4: Build source chain options with compose
  const multihopOptions = buildMultihopOptions(hopNativeFee);

  // MultiHopComposer address as bytes32
  const composerBytes32 = addressToBytes32(ARBITRUM_HUB.multiHopComposer);

  // Build the source chain SendParam (Source → Arbitrum MultiHopComposer)
  const sendParam = {
    dstEid: ARBITRUM_HUB.eid,
    to: composerBytes32,
    amountLD: amountLD,
    minAmountLD: (amountLD * 99n) / 100n,
    extraOptions: multihopOptions,
    composeMsg: composeMsg,
    oftCmd: '0x' as `0x${string}`,
  };

  // Get the source chain fee
  console.log(`  Quoting source chain fee (${srcChain} -> Arbitrum)...`);
  const msgFee = await srcClient.readContract({
    address: src.oftProxy,
    abi: OFT_ABI,
    functionName: 'quoteSend',
    args: [sendParam, false],
  });

  return {
    nativeFee: msgFee.nativeFee,
    lzTokenFee: msgFee.lzTokenFee,
    hopNativeFee,
    amountSent: amountLD,
    amountReceived: (amountLD * 99n) / 100n,
  };
}

// ============================================================================
// SEND
// ============================================================================

/**
 * Bridge USDT0 from an EVM chain to Tron via Arbitrum multihop.
 * Returns the transaction hash.
 */
export async function send(
  srcChain: ChainKey,
  tronRecipient: string,
  amountUsdt: number,
  privateKey: `0x${string}`,
): Promise<string> {
  const src = CHAINS[srcChain];
  const publicClient = getPublicClient(srcChain);
  const walletClient = getWalletClient(srcChain, privateKey);
  const account = walletClient.account!;
  const amountLD = parseUnits(amountUsdt.toString(), 6);

  // Check balance
  const balance = await publicClient.readContract({
    address: src.token,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  if (balance < amountLD) {
    throw new Error(`Insufficient balance: ${formatUnits(balance, 6)} USDT0 < ${amountUsdt} USDT0`);
  }
  console.log(`Balance: ${formatUnits(balance, 6)} USDT0`);

  // Check and set allowance if needed
  const allowance = await publicClient.readContract({
    address: src.token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, src.oftProxy],
  });
  if (allowance < amountLD) {
    console.log('Approving USDT0...');
    const approveHash = await walletClient.writeContract({
      address: src.token,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [src.oftProxy, amountLD],
    });
    await publicClient.waitForTransactionReceipt({hash: approveHash});
    console.log(`Approved: ${approveHash}`);
  }

  // Get quote (rebuilds all params internally)
  const quoteResult = await quote(srcChain, tronRecipient, amountUsdt);
  console.log(`\nTotal fee: ${formatEther(quoteResult.nativeFee)} ${src.nativeCurrency}`);

  // Rebuild the full send params for the transaction
  const tronBytes32 = tronAddressToBytes32(tronRecipient);
  const hopOptions = buildOptions();
  const hopSendParams = {
    dstEid: TRON_CONFIG.eid,
    to: tronBytes32,
    amountLD: amountLD,
    minAmountLD: (amountLD * 99n) / 100n,
    extraOptions: hopOptions,
    composeMsg: '0x' as `0x${string}`,
    oftCmd: '0x' as `0x${string}`,
  };

  const composeMsg = encodeAbiParameters(SEND_PARAMS_ABI, [hopSendParams]);
  const multihopOptions = buildMultihopOptions(quoteResult.hopNativeFee);
  const composerBytes32 = addressToBytes32(ARBITRUM_HUB.multiHopComposer);

  const sendParam = {
    dstEid: ARBITRUM_HUB.eid,
    to: composerBytes32,
    amountLD: amountLD,
    minAmountLD: (amountLD * 99n) / 100n,
    extraOptions: multihopOptions,
    composeMsg: composeMsg,
    oftCmd: '0x' as `0x${string}`,
  };

  // Execute send
  const txHash = await walletClient.writeContract({
    address: src.oftProxy,
    abi: OFT_ABI,
    functionName: 'send',
    args: [sendParam, {nativeFee: quoteResult.nativeFee, lzTokenFee: 0n}, account.address],
    value: quoteResult.nativeFee,
  });

  console.log(`Transaction: ${txHash}`);
  await publicClient.waitForTransactionReceipt({hash: txHash});

  return txHash;
}
