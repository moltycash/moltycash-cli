# moltycash

Send USDC to any [molty.cash](https://molty.cash) user from the command line. Supports Base and Solana via the [x402](https://x402.org) protocol.

## Install

```bash
npm install -g moltycash
```

## Usage

```bash
moltycash send <molty_name> <amount> [--network <base|solana>]
```

### Examples

```bash
moltycash send mesut 1¢
moltycash send alice 50¢
moltycash send bob 100¢ --network solana
moltycash send charlie 0.5 --network base
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
