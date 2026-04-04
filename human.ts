import minimist from "minimist";
import axios from "axios";
import { owsPayRequest, ensureOws } from "./ows.js";
import { loadIdentityToken, assertDomainAllowed, assertSpendAllowed, recordSpend } from "./wallet.js";

const baseURL = "https://api.molty.cash";
assertDomainAllowed(baseURL);

const identityToken = loadIdentityToken();

// ─── Shared Utilities ────────────────────────────────────────

function parseAmount(amountStr: string): number {
  const trimmed = amountStr.trim();

  if (trimmed.endsWith("\u00a2")) {
    const cents = parseFloat(trimmed.slice(0, -1));
    if (isNaN(cents)) throw new Error(`Invalid cents amount: ${amountStr}`);
    return cents / 100;
  }

  if (trimmed.startsWith("$")) {
    const dollarPart = trimmed.slice(1);
    if (/^\d+$/.test(dollarPart)) {
      const dollars = parseInt(dollarPart, 10);
      const cents = dollars * 100;
      throw new Error(
        `Dollar amounts like $${dollars} can be interpreted as shell variables. Please use ${cents}\u00a2 instead.`,
      );
    }
    const dollars = parseFloat(dollarPart);
    if (isNaN(dollars)) throw new Error(`Invalid dollar amount: ${amountStr}`);
    return dollars;
  }

  const amount = parseFloat(trimmed);
  if (isNaN(amount)) throw new Error(`Invalid amount: ${amountStr}`);
  return amount;
}

// ─── Tip Subcommand ──────────────────────────────────────────

async function handleTip(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3 || !args.wallet) {
    console.error("Usage: moltycash human tip <username> <amount> --wallet <name>");
    console.error("\nExamples:");
    console.error("  moltycash human tip 0xmesuthere 50\u00a2 --wallet agent-treasury");
    console.error("\nAmount formats: 100\u00a2 (cents - recommended), 0.5 (decimal)");
    process.exit(1);
  }

  const username = String(args._[1]);
  const wallet = String(args.wallet);
  let amount: number;

  try {
    amount = parseAmount(String(args._[2]));
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    if (amount > 10) throw new Error("Amount must be 10 USDC or less");
  } catch (error: any) {
    console.error(`\u274c ${error.message}`);
    process.exit(1);
  }

  assertSpendAllowed(amount);
  ensureOws();

  // Pre-flight: check if user has an agent on molty.cash
  const agentCardUrl = `${baseURL}/${username}/.well-known/agent-card.json`;
  try {
    await axios.get(agentCardUrl);
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`\n\u274c @${username} is not on molty.cash yet.\n`);
      console.error(`Invite them to join so you can tip them USDC:`);
      const tweetText = encodeURIComponent(
        `Hey @${username}, someone wants to tip you USDC! Sign up at https://molty.cash @moltycash`
      );
      console.error(`\n  https://x.com/intent/tweet?text=${tweetText}\n`);
      process.exit(1);
    }
  }

  const tipEndpoint = `${baseURL}/${username}/a2a`;
  console.log(`\n\u{1F4B8} Tipping @${username} ${amount} USDC...`);
  console.log(`   Wallet: ${wallet}`);
  if (identityToken) console.log(`   \u{1F510} Sending as verified sender`);
  console.log();

  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method: "tip",
    params: { amount, ...(identityToken && { identity_token: identityToken }) },
  };

  const output = owsPayRequest(tipEndpoint, body, wallet);

  // Parse OWS output — first line is "Paid $X on Y via x402", rest is JSON response
  const lines = output.split("\n");
  const jsonLine = lines.find((l) => l.startsWith("{"));
  if (jsonLine) {
    const parsed = JSON.parse(jsonLine);
    if (parsed.result?.status?.state === "failed") {
      const errorParts = parsed.result.status?.message?.parts || [];
      const errorMsg = errorParts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
      throw new Error(errorMsg || "Payment failed");
    }
    if (parsed.result) {
      const r = parsed.result;
      console.log(`\u2705 ${r.amount || amount} USDC sent to @${username}`);
      if (r.receipt) console.log(`   Receipt: ${r.receipt}`);
      recordSpend(amount);
      return;
    }
    if (parsed.error) {
      throw new Error(parsed.error.message || "Payment failed");
    }
  }

  console.log(output);
}

// ─── Hire Subcommand ─────────────────────────────────────────

async function handleHire(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3 || !args.amount || !args.wallet) {
    console.error('Usage: moltycash human hire <username> "<description>" --amount <USDC> --wallet <name>');
    console.error("\nExamples:");
    console.error('  moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1 --wallet agent-treasury');
    process.exit(1);
  }

  const username = String(args._[1]);
  const description = args._.slice(2).join(" ").trim();
  const wallet = String(args.wallet);

  let amount: number;
  try {
    amount = parseAmount(String(args.amount));
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    if (amount > 10) throw new Error("Amount must be 10 USDC or less");
  } catch (error: any) {
    console.error(`\u274c ${error.message}`);
    process.exit(1);
  }

  if (!description) {
    console.error("\u274c Description is required");
    process.exit(1);
  }

  if (description.length > 500) {
    console.error(`\u274c Description too long (${description.length} chars). Max 500 characters.`);
    process.exit(1);
  }

  assertSpendAllowed(amount);
  ensureOws();

  const hireEndpoint = `${baseURL}/${username}/a2a`;
  console.log(`\n\u{1F3AF} Hiring @${username} for ${amount} USDC...`);
  console.log(`   Wallet: ${wallet}`);
  console.log(`   Task: ${description}`);
  console.log();

  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method: "hire",
    params: { description, amount, ...(identityToken && { identity_token: identityToken }) },
  };

  const output = owsPayRequest(hireEndpoint, body, wallet);

  const lines = output.split("\n");
  const jsonLine = lines.find((l) => l.startsWith("{"));
  if (jsonLine) {
    const parsed = JSON.parse(jsonLine);
    if (parsed.result?.status?.state === "failed") {
      const errorParts = parsed.result.status?.message?.parts || [];
      const errorMsg = errorParts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
      throw new Error(errorMsg || "Hire failed");
    }
    if (parsed.result) {
      const r = parsed.result;
      console.log(`\u2705 @${username} hired!`);
      if (r.gig_id) console.log(`   Gig: ${r.gig_id}`);
      if (r.assignment_id) console.log(`   Assignment: ${r.assignment_id}`);
      console.log(`   Profile: https://molty.cash/${username}`);
      recordSpend(amount);
      return;
    }
    if (parsed.error) {
      throw new Error(parsed.error.message || "Hire failed");
    }
  }

  console.log(output);
}

// ─── Main ────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2));
const subcommand = args._[0];

if (!subcommand) {
  console.error("Usage: moltycash human <tip|hire>");
  console.error("\nSubcommands:");
  console.error("  tip <username> <amount> --wallet <name>                         Tip USDC");
  console.error('  hire <username> "<description>" --amount <USDC> --wallet <name> Hire');
  console.error("\nExamples:");
  console.error("  moltycash human tip 0xmesuthere 50\u00a2 --wallet agent-treasury");
  console.error('  moltycash human hire 0xmesuthere "Write an X Article" --amount 1 --wallet agent-treasury');
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    switch (subcommand) {
      case "tip":
        await handleTip(args);
        break;
      case "hire":
        await handleHire(args);
        break;
      default:
        console.error(`\u274c Unknown subcommand: ${subcommand}`);
        console.error("Available: tip, hire");
        process.exit(1);
    }
  } catch (error: any) {
    console.error(`\u274c ${error.message || "Command failed"}`);
    process.exit(1);
  }
}

main();
