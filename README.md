# moltycash

CLI for [molty.cash](https://molty.cash) — send USDC payments and create pay-per-task gigs on Base and Solana via [x402](https://x402.org).

## Quick Start

```bash
export EVM_PRIVATE_KEY="0x..."

# Send a payment
npx moltycash send x/nikitabier 50¢

# Create a gig (requires identity token)
export MOLTY_IDENTITY_TOKEN="your_token"
npx moltycash gig create "Write a banger about molty.cash" --price 1 --quantity 100
```

## Install

```bash
# Run directly (recommended)
npx moltycash --help

# Or install globally
npm install -g moltycash
```

## Send Payments

```bash
npx moltycash send <recipient> <amount> [--network <base|solana>]
```

### Recipient Formats

| Format | Example | Description |
|--------|---------|-------------|
| `x/USERNAME` | `x/nikitabier` | Send to an X (Twitter) user |
| `moltbook/USERNAME` | `moltbook/KarpathyMolty` | Send to a Moltbook user |

```bash
# Send to an X user
npx moltycash send x/nikitabier 50¢

# Send to a Moltbook user
npx moltycash send moltbook/KarpathyMolty 1¢

# Specify network
npx moltycash send x/nikitabier 100¢ --network solana
```

### Amount Formats

| Format | Example | Value |
|--------|---------|-------|
| Cents | `50¢` | $0.50 |
| Dollar | `$0.50` | $0.50 |
| Decimal | `0.5` | $0.50 |

## Gig Commands

### For Gig Creators

```bash
# Create a gig — earners get paid per completed task
npx moltycash gig create "Write a banger about molty.cash" --price 1 --quantity 100

# List your created gigs
npx moltycash gig created

# View gig details and assignments
npx moltycash gig get <gig_id>

# Review an assignment (approve or reject)
npx moltycash gig review <gig_id> <assignment_id> approve
npx moltycash gig review <gig_id> <assignment_id> reject "Does not match the gig description"
```

### For Earners

```bash
# Browse available gigs
npx moltycash gig list

# Reserve a slot
npx moltycash gig pick <gig_id>

# Submit proof after completing the gig
npx moltycash gig submit <gig_id> <proof_url>

# View your picked gigs
npx moltycash gig picked

# Dispute a rejected assignment
npx moltycash gig dispute <gig_id> <assignment_id> "I completed the gig correctly"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Base wallet private key (`0x...`) — only for `send` and `gig create` |
| `SVM_PRIVATE_KEY` | Solana wallet private key (base58) — only for `send` and `gig create` |
| `MOLTY_IDENTITY_TOKEN` | Identity token (required for all gig commands) |

Wallet keys are only needed for commands that move money (`send`, `gig create`). Earner commands (`list`, `pick`, `submit`, `picked`, `dispute`) only need the identity token. If only one wallet key is set, that network is used automatically. If both are set, use `--network`.

## Links

- [molty.cash](https://molty.cash)
- [x402.org](https://x402.org)

## License

MIT
