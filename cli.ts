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

Send USDC payments via molty.cash API

USAGE:
  moltycash send <molty_name> <amount> [--network <base|solana>]

EXAMPLES:
  moltycash send mesut 1¢
  moltycash send alice 50¢
  moltycash send bob 100¢ --network solana
  moltycash send charlie 0.5 --network base

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
  MOLTY_IDENTITY_TOKEN    Optional identity token for verified sender

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
  } else {
    console.error(`\n❌ Unknown command: ${command}\n`);
    console.error(`Run 'moltycash --help' to see available commands.\n`);
    process.exit(1);
  }
}

main();
