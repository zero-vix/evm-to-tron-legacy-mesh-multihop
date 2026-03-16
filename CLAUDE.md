# Tron Address Encoding for USDT0 OFT Compose Messages

## The Ask

A partner is integrating the USDT0 / SAIL.r flow. The forward path (USDT → SAIL.r: Tron → Arbitrum → Berachain, swap to SAIL.r) works. The return path (SAIL.r → USDT: Berachain → Arbitrum → Tron) fails: the cross-chain message is delivered (visible on LayerZero Scan), but USDT never arrives at their Tron keeper wallet.

They suspect the issue is how they encode the Tron destination address in the `to` field of the compose message for the second hop (Arb → Tron). They tried two encodings and want confirmation of the correct format.

## Tron Address Anatomy

A Tron address has three representations:

| Form | Example | Length |
|------|---------|--------|
| Base58check | `TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX` | 34 chars |
| Full hex (with network prefix) | `0x411a6ac17c82ad141ebc524a9ffc94965848f35279` | 21 bytes (42 hex chars) |
| EVM hex (without prefix) | `0x1a6ac17c82ad141ebc524a9ffc94965848f35279` | 20 bytes (40 hex chars) |

The `0x41` byte is a Tron network identifier. It is not part of the cryptographic address. Tron uses the same 20-byte ECDSA addressing as Ethereum.

## The Two Encodings They Tried

### Encoding A (Wrong) — 21 bytes with 0x41

Left-pad the full 21-byte Tron address (including 0x41) to 32 bytes:

```
0x0000000000000000000000411a6ac17c82ad141ebc524a9ffc94965848f35279
  |----11 zero bytes---|41|--------20-byte address-----------|
                        ^^
                        0x41 network prefix at byte index 11
```

Result: ~3.77 USDT test showed as "delivered" on LayerZero Scan, but tokens never arrived. Explorer showed "To: 0x0000...".

### Encoding B (Correct) — 20 bytes without 0x41

Strip the 0x41 prefix. Left-pad the remaining 20-byte EVM address to 32 bytes:

```
0x0000000000000000000000001a6ac17c82ad141ebc524a9ffc94965848f35279
  |------12 zero bytes------||--------20-byte address-----------|
```

This is what our production code uses.

## Why Encoding A Fails

This is subtle. The Solidity function `bytes32ToAddress` extracts the rightmost 20 bytes:

```solidity
address(uint160(uint256(to)))
```

Both encodings produce the **same rightmost 20 bytes** — the 0x41 sits at byte index 11, outside the rightmost 20. So the extracted address is identical.

However, the OFT contract validates that the upper 12 bytes are all zero:

```solidity
require(to == bytes32(uint256(uint160(address(uint160(uint256(to)))))))
```

This round-trips the bytes32 through address extraction and re-padding. If any upper byte is non-zero (0x41 at byte 11), the reconstructed value doesn't match the original, and the transaction reverts or the token credit is silently dropped.

This explains the observed behavior: the LayerZero message is delivered (the cross-chain part succeeds), but the final on-chain token credit on Tron fails the validation, so USDT never appears in the keeper wallet.

## Correct Implementation

### Step-by-step

1. Start with the Tron base58check address (e.g. `TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX`)
2. Base58-decode it to get 25 bytes: `[0x41, ...20 address bytes, ...4 checksum bytes]`
3. Take bytes 1–20 (the 20-byte EVM address), discard byte 0 (0x41) and bytes 21–24 (checksum)
4. Left-pad to 32 bytes with zeros

Or if starting from the hex representation `0x411a6ac...`:
1. Strip the leading `41` to get the 20-byte hex
2. Left-pad to 32 bytes with zeros

### Our production code path

```
addressToBytes32ForChain(address, 'tron')
  → toHexAddress(address)       // strips 0x41, returns 20-byte hex
  → hexZeroPad(hex, 32)         // left-pad to 32 bytes
```

Source files:
- `packages/ui-bridge-oft/src/utils.ts` — `addressToBytes32ForChain()` (line 127)
- `packages/ui-tron/src/address.ts` — `toHexAddress()` (line 7)

### Conversion examples

| Base58 | 20-byte hex | bytes32 |
|--------|------------|---------|
| `TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX` | `0x1a6ac17c82ad141ebc524a9ffc94965848f35279` | `0x0000000000000000000000001a6ac17c82ad141ebc524a9ffc94965848f35279` |
| `TEEFn7rQqx4Xc3GL1Bx27A155xAj7w5W7a` | `0x2eb90f8356345c903d9f85e58d1b8177890adfb6` | `0x0000000000000000000000002eb90f8356345c903d9f85e58d1b8177890adfb6` |
| `TGgd7pXdZALo9GyT4pmF2tT6JRf7ETWVcL` | `0x49a5f0cda413ab723fff9baf956329ecfe5d1a23` | `0x00000000000000000000000049a5f0cda413ab723fff9baf956329ecfe5d1a23` |

## Compose Message Structure

The compose message for the second hop (Arb → Tron) is an ABI-encoded `SendParam`:

```solidity
struct SendParam {
    uint32  dstEid;        // 30420 (Tron endpoint ID)
    bytes32 to;            // recipient — 20-byte address, zero-padded as above
    uint256 amountLD;      // amount in local decimals (6 for USDT)
    uint256 minAmountLD;   // minimum after fees/slippage
    bytes   extraOptions;  // 0x for defaults
    bytes   composeMsg;    // 0x (no further compose)
    bytes   oftCmd;        // 0x
}
```

Example for sending 1 USDT to `TCNtTa1rveKkovHR2ebABu4K66U6ocUCZX`:

```json
{
  "dstEid": 30420,
  "to": "0x0000000000000000000000001a6ac17c82ad141ebc524a9ffc94965848f35279",
  "amountLD": "1000000",
  "minAmountLD": "990000",
  "extraOptions": "0x",
  "composeMsg": "0x",
  "oftCmd": "0x"
}
```

ABI-encode this struct and use the result as the `composeMsg` field in the first hop's SendParam (source chain → Arb Composer).

Reference: `packages/ui-bridge-oft/src/tron/MultihopOftBridgeV3__tron.ts` lines 131–176 (`buildSendParams`).

## TL;DR

1. Strip the `0x41` prefix from the Tron address.
2. Use the remaining 20 bytes.
3. Left-pad to 32 bytes with zeros.
4. The Tron OFT re-adds `0x41` automatically on its side.

Encoding A (with 0x41 in the bytes32) fails an upper-byte validation check in the contract. The message delivers but the token credit is dropped.
