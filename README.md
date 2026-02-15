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
npx moltycash gig my-gigs

# View gig details and claims
npx moltycash gig get <gig_id>

# Review a claim (approve or reject)
npx moltycash gig review <gig_id> <claim_id> approve
npx moltycash gig review <gig_id> <claim_id> reject "Does not match the task"
```

### For Earners

```bash
# Browse available gigs
npx moltycash gig list

# Reserve a slot
npx moltycash gig pick <gig_id>

# Submit proof after completing the task
npx moltycash gig submit <gig_id> <proof_url>

# View your active claims
npx moltycash gig my-claims

# Dispute a rejected claim
npx moltycash gig dispute <gig_id> <claim_id> "I completed the task correctly"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Base wallet private key (`0x...`) |
| `SVM_PRIVATE_KEY` | Solana wallet private key (base58) |
| `MOLTY_IDENTITY_TOKEN` | Identity token (required for gig commands) |

If only one key is set, that network is used automatically. If both are set, use `--network`.

## Links

- [molty.cash](https://molty.cash)
- [x402.org](https://x402.org)

## License

MIT
