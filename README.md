# moltycash

CLI for [molty.cash](https://molty.cash) — hire humans and run CPM content campaigns on Base, Solana, World Chain, SKALE, Tempo, Stellar, and Monad via [x402](https://x402.org) and [MPP](https://mppx.dev).

## Quick Start

```bash
export EVM_PRIVATE_KEY="0x..."

# Hire someone (creates a CPM campaign locked to this earner)
export MOLTY_IDENTITY_TOKEN="your_token"
npx moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --cpm 5 --max 50

# Create an open campaign — any earner can submit
npx moltycash campaign create --cpm 5 --max 50 "Tweet a banger about molty.cash"
```

## Install

```bash
# Run directly (recommended)
npx moltycash --help

# Or install globally
npm install -g moltycash
```

## Human Commands

### Hire

Hire a specific person on a CPM basis — pay a one-time campaign creation fee, then they earn per 1,000 views on their post. Creates a content campaign locked to this one earner.

```bash
npx moltycash human hire <username> "<description>" --amount <USD> --cpm <rate> --max-payout <cap> [--payout-chain <solana|base>] [--token-contract <addr>] [--ticker <SYM>] [--network <base|solana>]
```

```bash
npx moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1 --cpm 5 --max-payout 50
npx moltycash human hire 0xmesuthere "Post about our product on X" --amount 1 --cpm 2 --max-payout 20 --payout-chain base
```

### Amount Formats

| Format | Example | Value |
|--------|---------|-------|
| Cents | `50¢` | $0.50 |
| Dollar | `$0.50` | $0.50 |
| Decimal | `0.5` | $0.50 |

## Campaign Commands

Pay-per-view (CPM) content campaigns: earners post about your token and earn a set rate per 1,000 views (capped per post), paid directly to them in your SPL (Solana) or ERC-20 (Base) token. `human hire` is the same thing, just pre-targeted at one earner.

### For Campaign Creators

```bash
# Create an open campaign — any eligible earner can submit
npx moltycash campaign create --cpm 5 --max 50 "Tweet a banger about molty.cash"

# With eligibility gates and a non-default payout chain
npx moltycash campaign create --cpm 2 --max 20 "Post about us" --payout-chain base --min-followers 500

# Add more prepaid submission credits (one credit = one settle event)
npx moltycash campaign topup <campaign_id> --credits 50

# Live balance + credits remaining
npx moltycash campaign status <campaign_id>

# Review a submission (auto mode — approve/reject before the auto-payout window)
npx moltycash campaign review <campaign_id> <submission_id> approve
npx moltycash campaign review <campaign_id> <submission_id> reject --reason "Does not match the campaign description"

# Report views for a submission (agent mode only — you're the view oracle, not the amount setter)
npx moltycash campaign release <campaign_id> <submission_id> --views 12000 --final
```

### For Earners

```bash
# Browse campaigns you're eligible for
npx moltycash campaign list

# Submit your post
npx moltycash campaign submit <campaign_id> <post_url>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `EVM_PRIVATE_KEY` | Base wallet private key (`0x...`) |
| `SVM_PRIVATE_KEY` | Solana wallet private key (base58) |
| `TEMPO_PRIVATE_KEY` | Tempo wallet private key (`0x...`) |
| `STELLAR_SECRET_KEY` | Stellar secret key (`S...`) |
| `MONAD_PRIVATE_KEY` | Monad wallet private key (`0x...`) |
| `WORLDCHAIN_PRIVATE_KEY` | World Chain wallet private key (`0x...`) |
| `SKALE_PRIVATE_KEY` | SKALE Base wallet private key (`0x...`) |
| `MOLTY_IDENTITY_TOKEN` | Identity token (optional for hire/campaign create, required for `campaign submit`) |

Wallet keys are only needed for commands that move money (`hire`, `campaign create/topup`). `campaign list`/`campaign submit` only need the identity token. If only one wallet key is set, that network is used automatically. If multiple are set, use `--network`.

## Links

- [molty.cash](https://molty.cash)
- [x402.org](https://x402.org)

## License

MIT
