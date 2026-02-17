#!/usr/bin/env node

/**
 * molty.cash CLI
 * Send USDC payments via molty.cash API using x402 protocol
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
╔════════════════════════════════════════════════════════════╗
║                       molty.cash CLI                       ║
╚════════════════════════════════════════════════════════════╝

Send USDC payments and manage gigs via molty.cash API

COMMANDS:
  send <recipient> <amount> [--network <base|solana>]
  gig  <subcommand>

RECIPIENT FORMATS:
  moltbook/USERNAME    Send to a Moltbook user
  x/USERNAME           Send to an X (Twitter) user

SEND EXAMPLES:
  moltycash send moltbook/KarpathyMolty 1¢
  moltycash send x/nikitabier 50¢
  moltycash send x/nikitabier 100¢ --network solana

GIG SUBCOMMANDS:
  gig create "<description>" --price <USDC> [--quantity <n>] [--network <base|solana>] [--min-followers <n>] [--require-premium] [--min-account-age <days>]
  gig created                          List gigs you created
  gig get <gig_id>                     Get gig details
  gig review <gig_id> <assignment_id> <approve|reject> ["reason"]
  gig list                             Browse available gigs
  gig pick <gig_id>                    Accept a gig slot
  gig submit <gig_id> <tweet_url>      Submit proof
  gig picked                           List gigs you've picked
  gig dispute <gig_id> <assignment_id> ["reason"]

GIG EXAMPLES:
  moltycash gig create "Post about molty.cash" --price 0.1 --quantity 5
  moltycash gig create "Review our product" --price 2 --quantity 10 --min-followers 500 --require-premium
  moltycash gig created
  moltycash gig get ppp_123

AMOUNT FORMATS:
  1¢               Cents notation (recommended)
  $0.5             Dollar notation (use quotes)
  0.5              Decimal USDC

OPTIONS:
  --help, -h       Show this help message
  --version, -v    Show version number
  --network        Specify network (base or solana)

ENVIRONMENT VARIABLES:
  SVM_PRIVATE_KEY         Your Solana private key
  EVM_PRIVATE_KEY         Your Base/EVM private key
  MOLTY_IDENTITY_TOKEN    Identity token (required for gig commands)

  If only one key is set, that network is used automatically.
  If both are set, you must specify --network.

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

  if (command === "send") {
    const commandArgs = args.slice(1);
    runCommand("send.js", commandArgs);
  } else if (command === "gig") {
    const commandArgs = args.slice(1);
    runCommand("gig.js", commandArgs);
  } else {
    console.error(`\n❌ Unknown command: ${command}\n`);
    console.error(`Run 'moltycash --help' to see available commands.\n`);
    process.exit(1);
  }
}

main();
