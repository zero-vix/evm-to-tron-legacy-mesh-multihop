# USDT0 Multihop Bridge: EVM → Arbitrum → Tron

Bridge USDT0 from an EVM chain (e.g. Berachain) to Tron in a single transaction using LayerZero multihop compose. The transfer routes through Arbitrum as the hub chain.

```
Berachain --[LayerZero]--> Arbitrum (MultiHopComposer) --[LayerZero]--> Tron
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Configure your settings in src/index.ts (recipient, amount, source chain)
# Or set EVM_PRIVATE_KEY in a .env file

# Run
pnpm start
```

## Configuration

Edit `USER_CONFIG` in `src/index.ts`:

| Setting | Description |
|---------|-------------|
| `privateKey` | EVM private key (0x...). Can use `EVM_PRIVATE_KEY` env var |
| `tronRecipient` | Tron destination address (Base58check like `T...` or hex) |
| `amount` | USDT amount to bridge (e.g., 1.5 = $1.50) |
| `srcChain` | Source EVM chain key (default: `bera` for Berachain) |

## Requirements

- USDT0 tokens on the source EVM chain
- Native gas token for LayerZero fees (covers both hops) + transaction costs

## Tron Address Encoding

**This is the most critical part of the integration.** Tron addresses have a `0x41` network prefix that MUST be stripped before encoding as `bytes32`.

### Correct (Encoding B)

Strip `0x41`, use the 20-byte EVM address, left-pad to 32 bytes:

```
Tron address: TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX
Hex (with 0x41): 0x411a6ac17c82ad141ebc524a9ffc94965848f35279
Strip 0x41:      0x1a6ac17c82ad141ebc524a9ffc94965848f35279
bytes32:         0x0000000000000000000000001a6ac17c82ad141ebc524a9ffc94965848f35279
                   |------12 zero bytes------||--------20-byte address-----------|
```

### Wrong (Encoding A)

Including the `0x41` in the bytes32:

```
bytes32: 0x0000000000000000000000411a6ac17c82ad141ebc524a9ffc94965848f35279
                               ^^
                               0x41 at byte index 11 — fails validation
```

### Why Encoding A Fails

The OFT contract validates that upper bytes are zero:

```solidity
require(to == bytes32(uint256(uint160(address(uint160(uint256(to)))))))
```

This round-trips through `address` (20 bytes). If byte 11 is `0x41`, the round-trip produces a different value, and the token credit is silently dropped — the LayerZero message shows "delivered" but USDT never arrives.

## How It Works

1. **Quote hop fee** — Calls `quoteSend` on the Arbitrum OFT contract to get the fee for the second hop (Arbitrum → Tron)
2. **Build compose message** — ABI-encodes the hop chain `SendParams` (dstEid=30420, Tron recipient as bytes32, amount, options)
3. **Build executor options** — Creates TYPE_3 options with `addExecutorComposeOption` that includes enough gas and native ETH (with 10% buffer) to pay for the second hop on Arbitrum
4. **Quote source chain fee** — Calls `quoteSend` on the source chain with the full compose message to get the total LayerZero fee
5. **Send** — Executes the source chain transaction to the MultiHopComposer on Arbitrum
6. **Auto-forward** — The MultiHopComposer receives the compose callback, decodes the `SendParams`, and automatically sends the tokens to Tron

### Key Addresses

| Contract | Address |
|----------|---------|
| Berachain OFT Proxy | `0x3Dc96399109df5ceb2C226664A086140bD0379cB` |
| Arbitrum OFT Proxy | `0x14E4A1B13bf7F943c8ff7C51fb60FA964A298D92` |
| Arbitrum MultiHopComposer | `0x759BA420bF1ded1765F18C2DC3Fc57A1964A2Ad1` |
| Tron Endpoint ID | 30420 |
