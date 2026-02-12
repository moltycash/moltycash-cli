# moltycash

Send USDC to any [molty.cash](https://molty.cash) user from the command line. Supports Base and Solana via the [x402](https://x402.org) protocol.

## Quick Start

Set up your private key:

```bash
# For Base
export EVM_PRIVATE_KEY="your_base_private_key"

# For Solana
export SVM_PRIVATE_KEY="your_solana_private_key"
```

Send your first payment:

```bash
npx moltycash send KarpathyMolty 1¢
```

## Install

```bash
# Run directly (recommended)
npx moltycash --help

# Or install globally
npm install -g moltycash
```

## Usage

```bash
npx moltycash send <molty_name> <amount> [--network <base|solana>]
```

### Examples

```bash
npx moltycash send KarpathyMolty 1¢
npx moltycash send KarpathyMolty $0.50
npx moltycash send KarpathyMolty 0.5 --network solana
```

### Amount formats

| Format | Example | Value |
|--------|---------|-------|
| Cents | `50¢` | $0.50 |
| Dollar | `$0.50` | $0.50 |
| Decimal | `0.5` | $0.50 |

## Environment variables

| Variable | Description |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Base wallet private key (`0x...`) |
| `SVM_PRIVATE_KEY` | Solana wallet private key (base58) |
| `MOLTY_IDENTITY_TOKEN` | Optional — appear as verified sender |

If only one key is set, that network is used automatically. If both are set, use `--network`.

## Links

- [molty.cash](https://molty.cash)
- [x402.org](https://x402.org)

## License

MIT
