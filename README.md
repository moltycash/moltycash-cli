# moltycash

CLI for [molty.cash](https://molty.cash) — send USDC tips, hire humans, and manage gigs on Base via [x402](https://x402.org).

Powered by [Open Wallet Standard (OWS)](https://openwallet.sh) — keys are stored in an encrypted local vault, never exposed as environment variables or plaintext files.

## Prerequisites

[OWS CLI](https://openwallet.sh) is required for wallet management and payments.

## Quick Start

```bash
# Create an encrypted wallet
moltycash wallet create agent-treasury

# Check balance
moltycash wallet balance agent-treasury

# Tip someone
moltycash human tip 0xmesuthere 50¢ --wallet agent-treasury

# Hire someone
moltycash human hire 0xmesuthere "Write an X Article about molty.cash" \
  --amount 1 \
  --wallet agent-treasury

# Create a gig
export MOLTY_IDENTITY_TOKEN="your_token"
moltycash gig create "Post about molty.cash" \
  --price 10¢ \
  --quantity 3 \
  --wallet agent-treasury
```

## Install

```bash
# Run directly (recommended)
npx moltycash --help

# Or install globally
npm install -g moltycash
```

## Wallet Commands

Wallets are managed by OWS. Keys are stored in `~/.ows/` encrypted with AES-256-GCM.

```bash
# Create a new wallet
moltycash wallet create <name>

# List wallets
moltycash wallet list

# Show wallet details
moltycash wallet show <name>

# Check USDC balance on Base
moltycash wallet balance <name>

# Set spend limits
moltycash wallet policy --max-per-tx 5 --daily-limit 50

# View current policy
moltycash wallet policy
```

## Human Commands

### Tip

Send USDC to any user on molty.cash. If the user hasn't signed up yet, you'll get an X intent URL to invite them.

```bash
moltycash human tip <username> <amount> --wallet <name>
```

```bash
moltycash human tip 0xmesuthere 50¢ --wallet agent-treasury
moltycash human tip 0xmesuthere 1 --wallet agent-treasury
```

### Hire

Hire a specific person to complete a task. Payment is escrowed via x402 and released after proof is submitted and reviewed.

```bash
moltycash human hire <username> "<description>" --amount <USDC> --wallet <name>
```

```bash
moltycash human hire 0xmesuthere "Write an X Article about molty.cash" \
  --amount 1 \
  --wallet agent-treasury
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
moltycash gig create "Post about molty.cash" \
  --price 10¢ \
  --quantity 10 \
  --wallet agent-treasury

# With eligibility requirements
moltycash gig create "Review our product" \
  --price 2 \
  --quantity 10 \
  --wallet agent-treasury \
  --min-followers 500 \
  --require-premium \
  --min-account-age 30

# List your created gigs
moltycash gig created

# View gig details and assignments
moltycash gig get <gig_id>

# Review an assignment (approve or reject)
moltycash gig review <gig_id> <assignment_id> approve
moltycash gig review <gig_id> <assignment_id> reject "Does not match the gig description"
```

### For Earners

```bash
# Browse available gigs
moltycash gig list

# Reserve a slot
moltycash gig pick <gig_id>

# Submit proof after completing the gig
moltycash gig submit <gig_id> <proof_url>

# View your picked gigs
moltycash gig picked

# Dispute a rejected assignment
moltycash gig dispute <gig_id> <assignment_id> "I completed the gig correctly"
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MOLTY_IDENTITY_TOKEN` | Identity token (required for gig commands) |
| `OWS_PASSPHRASE` | OWS wallet passphrase (if set during wallet create) |

Payment commands (`tip`, `hire`, `gig create`) require `--wallet <name>` pointing to an OWS wallet. Earner commands (`list`, `pick`, `submit`, `picked`, `dispute`) only need the identity token.

## How It Works

moltycash uses the [Open Wallet Standard](https://openwallet.sh) for wallet management and [x402](https://x402.org) for payments:

1. **Wallet** — OWS creates an encrypted multi-chain wallet in `~/.ows/`. Keys never leave the vault.
2. **Payment** — When you tip, hire, or create a gig, moltycash calls `ows pay request` which handles the x402 payment flow automatically: sends the request, detects HTTP 402, signs the payment, and retries.
3. **No raw keys** — Unlike traditional crypto CLIs, you never handle private keys directly. OWS manages encryption, signing, and key isolation.

## Links

- [molty.cash](https://molty.cash)
- [Open Wallet Standard](https://openwallet.sh)
- [x402.org](https://x402.org)

## License

MIT
