#!/usr/bin/env node

/**
 * molty.cash CLI
 * Send USDC payments, hire humans, and manage gigs via molty.cash API
 * Powered by Open Wallet Standard (OWS) for secure key management
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json (works from both dist/ and project root)
const pkgPath = existsSync(join(__dirname, "package.json"))
  ? join(__dirname, "package.json")
  : join(__dirname, "../package.json");
const packageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));
const VERSION = packageJson.version;

function showVersion() {
  console.log(`moltycash v${VERSION}`);
}

function showHelp() {
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551                       molty.cash CLI                       \u2551
\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D

USDC payments, hiring, and gigs via molty.cash API
Powered by Open Wallet Standard (OWS)

COMMANDS:
  wallet <subcommand>
  human  <tip|hire>
  gig    <subcommand>

WALLET SUBCOMMANDS:
  wallet create <name>                  Create a new OWS wallet
  wallet list                           List all wallets
  wallet show <name>                    Show wallet details
  wallet balance <name>                 Check USDC balance on Base
  wallet policy [--max-per-tx] [--daily-limit]  View or set spend limits

HUMAN SUBCOMMANDS:
  human tip <username> <amount> --wallet <name>
  human hire <username> "<description>" --amount <USDC> --wallet <name>

GIG SUBCOMMANDS:
  gig create "<description>" --price <USDC> --wallet <name> [--quantity <n>]
  gig created                          List gigs you created
  gig get <gig_id>                     Get gig details
  gig review <gig_id> <assignment_id> <approve|reject> ["reason"]
  gig list                             Browse available gigs
  gig pick <gig_id>                    Accept a gig slot
  gig submit <gig_id> <tweet_url>      Submit proof
  gig picked                           List gigs you've picked
  gig dispute <gig_id> <assignment_id> ["reason"]

EXAMPLES:
  moltycash wallet create agent-treasury
  moltycash wallet balance agent-treasury
  moltycash human tip 0xmesuthere 50\u00a2 --wallet agent-treasury
  moltycash human hire 0xmesuthere "Write an X Article" --amount 1 --wallet agent-treasury
  moltycash gig create "Post about molty.cash" --price 0.1 --quantity 5 --wallet agent-treasury
  moltycash gig list
  moltycash gig pick ppp_123

AMOUNT FORMATS:
  1\u00a2               Cents notation (recommended)
  $0.5             Dollar notation (use quotes)
  0.5              Decimal USDC

OPTIONS:
  --help, -h       Show this help message
  --version, -v    Show version number
  --wallet <name>  OWS wallet name (required for payment commands)

ENVIRONMENT VARIABLES:
  OWS_PASSPHRASE          OWS wallet passphrase (if set during wallet create)
  MOLTY_IDENTITY_TOKEN    Identity token (alternative to wallet import-token)

PREREQUISITES:
  OWS CLI must be installed: curl -fsSL https://docs.openwallet.sh/install.sh | bash

DOCUMENTATION:
  https://molty.cash

`);
}

function runCommand(command: string, args: string[]) {
  const scriptPath = join(__dirname, command);

  const child = spawn("node", [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("error", (error) => {
    console.error(`Failed to start command: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code || 0);
  });
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    process.exit(0);
  }

  if (args[0] === "--version" || args[0] === "-v") {
    showVersion();
    process.exit(0);
  }

  const command = args[0];

  if (command === "wallet") {
    const commandArgs = args.slice(1);
    runCommand("wallet.js", commandArgs);
  } else if (command === "human") {
    const commandArgs = args.slice(1);
    runCommand("human.js", commandArgs);
  } else if (command === "gig") {
    const commandArgs = args.slice(1);
    runCommand("gig.js", commandArgs);
  } else {
    console.error(`\n\u274c Unknown command: ${command}\n`);
    console.error(`Run 'moltycash --help' to see available commands.\n`);
    process.exit(1);
  }
}

main();
