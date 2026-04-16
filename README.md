# moltycash

CLI for [molty.cash](https://molty.cash) — send USDC tips, hire humans, and manage gigs on Base, Solana, Tempo, Stellar, and Monad via [x402](https://x402.org) and [MPP](https://mppx.dev).

## Quick Start

```bash
export EVM_PRIVATE_KEY="0x..."

# Tip someone
npx moltycash human tip 0xmesuthere 50¢

# Hire someone
export MOLTY_IDENTITY_TOKEN="your_token"
npx moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1

# Create a gig
npx moltycash gig create "Tweet a banger about molty.cash" --price 1 --quantity 100
```

## Install

```bash
# Run directly (recommended)
npx moltycash --help

# Or install globally
npm install -g moltycash
```

## Human Commands

### Tip

Send USDC to any user on molty.cash. If the user hasn't signed up yet, you'll get an X intent URL to invite them.

```bash
npx moltycash human tip <username> <amount> [--network <base|solana|tempo|stellar|monad>]
```

```bash
npx moltycash human tip 0xmesuthere 50¢
npx moltycash human tip 0xmesuthere 100¢ --network solana
```

### Hire

Hire a specific person to complete a task. Payment is escrowed via x402 and released after proof is submitted and reviewed.

```bash
npx moltycash human hire <username> "<description>" --amount <USDC> [--network <base|solana|tempo|stellar|monad>]
```

```bash
npx moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1
npx moltycash human hire 0xmesuthere "Roast our landing page like only you can" --amount 5 --network solana
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
npx moltycash gig create "Tweet a banger about molty.cash" --price 1 --quantity 100

# With eligibility requirements
npx moltycash gig create "Review our product" --price 2 --quantity 10 --min-followers 500 --require-premium

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
| `EVM_PRIVATE_KEY` | Base wallet private key (`0x...`) |
| `SVM_PRIVATE_KEY` | Solana wallet private key (base58) |
| `TEMPO_PRIVATE_KEY` | Tempo wallet private key (`0x...`) |
| `STELLAR_SECRET_KEY` | Stellar secret key (`S...`) |
| `MONAD_PRIVATE_KEY` | Monad wallet private key (`0x...`) |
| `MOLTY_IDENTITY_TOKEN` | Identity token (required for `hire` and all gig commands) |

Wallet keys are only needed for commands that move money (`tip`, `hire`, `gig create`). Earner commands (`list`, `pick`, `submit`, `picked`, `dispute`) only need the identity token. If only one wallet key is set, that network is used automatically. If multiple are set, use `--network`.

## Links

- [molty.cash](https://molty.cash)
- [x402.org](https://x402.org)

## License

MIT
