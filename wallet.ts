/**
 * Molty Wallet — delegates to OWS for key management, stores identity token locally.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import minimist from "minimist";
import { owsExec, ensureOws } from "./ows.js";

const MOLTY_DIR = join(homedir(), ".molty");
const POLICY_PATH = join(MOLTY_DIR, "policy.json");
const SPEND_LOG_PATH = join(MOLTY_DIR, "spend_log.json");

const DOMAIN_ALLOWLIST = ["api.molty.cash"];

// ─── Directory ───────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(MOLTY_DIR)) {
    mkdirSync(MOLTY_DIR, { mode: 0o700 });
  }
}

// ─── Identity Token ──────────────────────────────────────────

export function loadIdentityToken(): string | undefined {
  return process.env.MOLTY_IDENTITY_TOKEN;
}

// ─── Policy ──────────────────────────────────────────────────

interface PolicyData {
  max_per_tx?: number;
  daily_limit?: number;
}

function loadPolicy(): PolicyData {
  if (!existsSync(POLICY_PATH)) return {};
  try {
    return JSON.parse(readFileSync(POLICY_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function savePolicy(data: PolicyData): void {
  ensureDir();
  writeFileSync(POLICY_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

// ─── Domain Allowlist ────────────────────────────────────────

export function assertDomainAllowed(url: string): void {
  const hostname = new URL(url).hostname;
  if (!DOMAIN_ALLOWLIST.includes(hostname)) {
    console.error(`\u274c Domain not allowed: ${hostname}`);
    console.error(`   Allowed: ${DOMAIN_ALLOWLIST.join(", ")}`);
    process.exit(1);
  }
}

// ─── Spend Tracking ──────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

interface SpendEntry {
  amount: number;
  timestamp: number;
}

function loadSpendLog(): SpendEntry[] {
  if (!existsSync(SPEND_LOG_PATH)) return [];
  try {
    return JSON.parse(readFileSync(SPEND_LOG_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function saveSpendLog(entries: SpendEntry[]): void {
  ensureDir();
  writeFileSync(SPEND_LOG_PATH, JSON.stringify(entries, null, 2), { mode: 0o600 });
}

export function assertSpendAllowed(amount: number): void {
  const policy = loadPolicy();

  if (policy.max_per_tx !== undefined && amount > policy.max_per_tx) {
    console.error(`\u274c Per-transaction limit exceeded: ${amount} USDC > ${policy.max_per_tx} USDC max`);
    process.exit(1);
  }

  if (policy.daily_limit !== undefined) {
    const now = Date.now();
    const recentEntries = loadSpendLog().filter((e) => now - e.timestamp < DAY_MS);
    const rollingTotal = recentEntries.reduce((sum, e) => sum + e.amount, 0);
    if (rollingTotal + amount > policy.daily_limit) {
      console.error(`\u274c Daily limit exceeded: ${rollingTotal.toFixed(2)} spent + ${amount} = ${(rollingTotal + amount).toFixed(2)} USDC > ${policy.daily_limit} USDC daily limit`);
      process.exit(1);
    }
  }
}

export function recordSpend(amount: number): void {
  const now = Date.now();
  const entries = loadSpendLog().filter((e) => now - e.timestamp < DAY_MS);
  entries.push({ amount, timestamp: now });
  saveSpendLog(entries);
}

// ─── CLI Commands ────────────────────────────────────────────

function filterBaseLines(output: string): string {
  return output
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // Keep non-chain lines (headers, blank lines, etc.)
      if (!trimmed.startsWith("eip155:") && !trimmed.startsWith("solana:") &&
          !trimmed.startsWith("bip122:") && !trimmed.startsWith("cosmos:") &&
          !trimmed.startsWith("tron:") && !trimmed.startsWith("ton:") &&
          !trimmed.startsWith("fil:") && !trimmed.startsWith("sui:") &&
          !trimmed.startsWith("xrpl:") && !trimmed.startsWith("spark:")) {
        return true;
      }
      // Keep only EVM (Base) lines
      return trimmed.startsWith("eip155:");
    })
    .join("\n");
}

function extractWalletInfo(output: string): { name?: string; address?: string } {
  const nameLine = output.match(/Name:\s+(.+)/);
  const evmLine = output.match(/eip155:\S+.*?\u2192\s*(0x[a-fA-F0-9]+)/);
  return {
    name: nameLine?.[1]?.trim(),
    address: evmLine?.[1],
  };
}

function handleCreate(args: minimist.ParsedArgs): void {
  const name = args._[1];
  if (!name) {
    console.error("Usage: moltycash wallet create <name>");
    process.exit(1);
  }
  ensureOws();
  const output = owsExec(["wallet", "create", "--name", String(name)]);
  const info = extractWalletInfo(output);
  console.log(`Wallet created: ${info.name}`);
  if (info.address) console.log(`Address: ${info.address} (Base)`);
}

function handleList(): void {
  ensureOws();
  const output = owsExec(["wallet", "list"]);
  // OWS may list multiple wallets separated by blank lines
  const blocks = output.split(/\n\n+/).filter((b) => b.trim());
  for (const block of blocks) {
    const info = extractWalletInfo(block);
    if (info.name) {
      const short = info.address ? `${info.address.slice(0, 6)}...${info.address.slice(-4)}` : "";
      console.log(`${info.name}  ${short} (Base)`);
    }
  }
}

function handleShow(args: minimist.ParsedArgs): void {
  const name = args._[1];
  if (!name) {
    console.error("Usage: moltycash wallet show <name>");
    process.exit(1);
  }
  ensureOws();
  const output = owsExec(["wallet", "list"]);
  const info = extractWalletInfo(output);
  console.log(`Name:    ${info.name}`);
  if (info.address) console.log(`Address: ${info.address} (Base)`);
}

function handleBalance(args: minimist.ParsedArgs): void {
  const name = args._[1];
  if (!name) {
    console.error("Usage: moltycash wallet balance <name>");
    process.exit(1);
  }
  ensureOws();
  const info = owsExec(["wallet", "list"]);
  const evmLine = info.split("\n").find((l) => l.trim().startsWith("eip155:"));
  if (evmLine) {
    const match = evmLine.match(/\u2192\s*(0x[a-fA-F0-9]+)/);
    if (match) console.log(`Address: ${match[1]} (Base)`);
  }
  const output = owsExec(["fund", "balance", "--wallet", String(name), "--chain", "base"]);
  const dollarMatch = output.match(/\$[\d.]+/);
  console.log(`Balance: ${dollarMatch ? dollarMatch[0] : "$0.00"} USDC`);
}

function handlePolicy(args: minimist.ParsedArgs): void {
  const maxPerTx = args["max-per-tx"] as number | undefined;
  const dailyLimit = args["daily-limit"] as number | undefined;

  if (maxPerTx === undefined && dailyLimit === undefined) {
    const policy = loadPolicy();
    console.log("\nSpend Policy:");
    console.log("  Allowlist:     " + DOMAIN_ALLOWLIST.join(", ") + " (hardcoded)");
    console.log("  Max per tx:    " + (policy.max_per_tx !== undefined ? policy.max_per_tx + " USDC" : "(not set)"));
    console.log("  Daily limit:   " + (policy.daily_limit !== undefined ? policy.daily_limit + " USDC" : "(not set)"));
    console.log();
    return;
  }

  const policy = loadPolicy();
  const updated: string[] = [];

  if (maxPerTx !== undefined) {
    if (maxPerTx <= 0) {
      console.error("Max per tx must be greater than 0");
      process.exit(1);
    }
    policy.max_per_tx = maxPerTx;
    updated.push(`max per tx: ${maxPerTx} USDC`);
  }

  if (dailyLimit !== undefined) {
    if (dailyLimit <= 0) {
      console.error("Daily limit must be greater than 0");
      process.exit(1);
    }
    policy.daily_limit = dailyLimit;
    updated.push(`daily limit: ${dailyLimit} USDC`);
  }

  savePolicy(policy);
  console.log("Policy updated: " + updated.join(", "));
}

function showHelp(): void {
  console.log(`
Usage: moltycash wallet <command>

COMMANDS:
  create <name>                         Create a new OWS wallet
  list                                  List all wallets
  show <name>                           Show wallet details
  balance <name>                         Check USDC balance on Base
  policy [--max-per-tx] [--daily-limit] View or set spend limits

EXAMPLES:
  moltycash wallet create agent-treasury
  moltycash wallet list
  moltycash wallet balance agent-treasury
  moltycash wallet policy --max-per-tx 5 --daily-limit 50

ENVIRONMENT VARIABLES:
  MOLTY_IDENTITY_TOKEN    Identity token (required for gig commands)
  OWS_PASSPHRASE          OWS wallet passphrase (if set during wallet create)

STORAGE:
  Wallet keys: ~/.ows/ (encrypted, managed by OWS)
  Spend policy: ~/.molty/policy.json
`);
}

// ─── Main (only when run directly) ───────────────────────────

const isMain = process.argv[1]?.endsWith("wallet.js") || process.argv[1]?.endsWith("wallet.ts");
if (isMain) {

const args = minimist(process.argv.slice(2));
const subcommand = args._[0];

if (!subcommand || subcommand === "help" || args.help || args.h) {
  showHelp();
  process.exit(0);
}

try {
  switch (subcommand) {
    case "create":
      handleCreate(args);
      break;
    case "list":
      handleList();
      break;
    case "show":
      handleShow(args);
      break;
    case "balance":
      handleBalance(args);
      break;
    case "policy":
      handlePolicy(args);
      break;
    default:
      console.error(`Unknown wallet command: ${subcommand}`);
      console.error("Available: create, list, show, balance, policy");
      process.exit(1);
  }
} catch (error: any) {
  console.error(`\u274c ${error.message || "Command failed"}`);
  process.exit(1);
}

} // end isMain
