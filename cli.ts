#!/usr/bin/env node

/**
 * molty.cash CLI
 * Hire humans and manage CPM content campaigns via molty.cash API
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

USDC payments and campaigns via molty.cash API

COMMANDS:
  human    <hire>
  campaign <subcommand>
  reward   <balance|claim>

HUMAN SUBCOMMANDS:
  human hire <username> "<description>" --amount <USD> --cpm <rate> --max-payout <cap> [--payout-chain <solana|base>] [--token-contract <addr>] [--ticker <SYM>] [--network <base|solana>]
             (Performance hire only — creates a CPM campaign locked to this earner; --amount is the one-time creation fee)

CAMPAIGN SUBCOMMANDS (pay-per-view / CPM content campaigns; daily payouts; token payouts on Solana or Base):
  campaign create --cpm <rate> --max <cap> "<description>"
       [--chain <solana|base>] [--token <addr>] [--ticker <SYM>] [--window <days>]
       [--credits <n>] [--mode <auto|agent>] [--releaser <wallet>]
       Daily payouts: guaranteed base payout ~2h after posting, then daily top-ups on
       new views for --window days (default 7). --token defaults to USDC on the chain.
       --credits defaults to a standard grant; campaign pauses when they run out.
  campaign topup <campaign_id> --credits <n>       Buy more submission credits
  campaign status <campaign_id>                    Live balance + credits (1¢)
  campaign review <campaign_id> <submission_id> <approve|reject> [--reason <text>]  (auto mode, 1¢)
  campaign release <campaign_id> <submission_id> --views <n> [--final] [--reject]   (agent mode, 1¢)
  campaign close <campaign_id>                     Reject in-flight submissions, refund remaining
                                                    balance to your registered payout destination, close (1¢)
  campaign list                                    Browse campaigns you can earn from
  campaign submit <campaign_id> <post_url>         Submit your post to a campaign

REWARD SUBCOMMANDS (pay 1¢/call via x402):
  reward balance                                 Show $moltycash balance + tier info
  reward claim --destination <0x...>             Claim all $moltycash to a Base EVM address

HUMAN HIRE EXAMPLES:
  moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1 --cpm 5 --max-payout 50
  moltycash human hire 0xmesuthere "Post about us on X" --amount 1 --cpm 2 --max-payout 20 --payout-chain base

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
  MOLTY_IDENTITY_TOKEN    Identity token (optional for hire, required for campaign earner commands)

  If only one key is set, that network is used automatically.
  If multiple keys are set, you must specify --network.

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

  if (command === "human") {
    const commandArgs = args.slice(1);
    runCommand("human.js", commandArgs);
  } else if (command === "gig") {
    console.error('\n❌ The "gig" command has been removed.\n');
    console.error('Use "campaign" commands to create and manage CPM content campaigns.\n');
    process.exit(1);
  } else if (command === "campaign") {
    const commandArgs = args.slice(1);
    runCommand("campaign.js", commandArgs);
  } else if (command === "reward") {
    const commandArgs = args.slice(1);
    runCommand("reward.js", commandArgs);
  } else {
    console.error(`\n❌ Unknown command: ${command}\n`);
    console.error(`Run 'moltycash --help' to see available commands.\n`);
    process.exit(1);
  }
}

main();
