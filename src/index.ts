/**
 * USDT0 Multihop Bridge: EVM → Arbitrum → Tron
 *
 * Bridges USDT0 from an EVM chain (e.g. Berachain) to Tron in a single
 * transaction using LayerZero multihop compose. The transfer routes through
 * Arbitrum as the hub chain:
 *
 *   Berachain --[LayerZero]--> Arbitrum (MultiHopComposer) --[LayerZero]--> Tron
 *
 * IMPORTANT: Tron Address Encoding
 *   Tron addresses have a 0x41 network prefix that MUST be stripped before
 *   encoding as bytes32. The OFT contract validates that the upper 12 bytes
 *   are all zero. Including 0x41 causes the token credit to be silently dropped
 *   even though the LayerZero message shows as "delivered".
 *
 *   Correct: strip 0x41, use 20-byte EVM address, left-pad to 32 bytes
 *   Wrong:   include 0x41 in the bytes32 (fails upper-byte validation)
 *
 * Setup:
 *   1. pnpm install
 *   2. Configure USER_CONFIG below (or set EVM_PRIVATE_KEY in .env)
 *   3. pnpm start
 *
 * Requirements:
 *   - USDT0 tokens on the source EVM chain
 *   - Native gas token for LayerZero fees (covers both hops) + transaction costs
 */

import 'dotenv/config';
import { formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { CHAINS, type ChainKey } from './protocol.js';
import { quote, send } from './bridge.js';

// ============================================================================
// USER SETTINGS
// ============================================================================

const USER_CONFIG = {
  privateKey: (process.env.EVM_PRIVATE_KEY || '') as `0x${string}`,
  /** Tron recipient address (Base58check or hex format) */
  tronRecipient: 'TD1JpbDFSZgCfFEcgSe5PgmtogkFC3yD71',
  amount: 0.10, // USDT amount
  srcChain: 'bera' as ChainKey, // Source EVM chain
};

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const { srcChain, tronRecipient, amount, privateKey } = USER_CONFIG;
  const src = CHAINS[srcChain];

  console.log(`\nUSDT0 Multihop Bridge: ${srcChain} -> Arbitrum -> Tron`);
  console.log(`  To (Tron): ${tronRecipient}`);
  console.log(`  Amount: ${amount} USDT\n`);

  // Quote (gets fees for both hops)
  console.log('Getting fee quotes...');
  const quoteResult = await quote(srcChain, tronRecipient, amount);
  console.log(`\nTotal fee: ${formatEther(quoteResult.nativeFee)} ${src.nativeCurrency}`);

  if (!privateKey) {
    console.log('\nSet EVM_PRIVATE_KEY in .env to send');
    return;
  }

  // Send
  const account = privateKeyToAccount(privateKey);
  console.log(`\nFrom: ${account.address}`);
  console.log('Sending multihop transaction...');

  const txHash = await send(srcChain, tronRecipient, amount, privateKey);
  console.log(`\nSuccess! Track at: https://layerzeroscan.com/tx/${txHash}`);
  console.log(`\nNote: This is a multihop transaction. LayerZero Scan will show two messages:`);
  console.log(`  1. ${srcChain} -> Arbitrum (initial send)`);
  console.log(`  2. Arbitrum -> Tron (composed forward)`);
}

main().catch(console.error);
