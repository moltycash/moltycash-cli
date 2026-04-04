import minimist from "minimist";
import axios from "axios";
import { owsPayRequest, ensureOws } from "./ows.js";
import { loadIdentityToken, assertDomainAllowed, assertSpendAllowed, recordSpend } from "./wallet.js";

const baseURL = "https://api.molty.cash";
assertDomainAllowed(baseURL);

const identityToken = loadIdentityToken();

let rpcIdCounter = 1;

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

/**
 * Send A2A JSON-RPC 2.0 request (non-payment commands)
 */
async function a2aCall(
  method: string,
  params: Record<string, unknown>,
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const response = await axios.post(
    `${baseURL}/a2a`,
    {
      jsonrpc: "2.0",
      id: rpcIdCounter++,
      method,
      params,
    },
    { headers },
  );

  if (response.data.error) {
    throw new Error(response.data.error.message || "A2A request failed");
  }

  return response.data.result;
}

// ───── Payer subcommands ─────

async function handleCreate(args: minimist.ParsedArgs): Promise<void> {
  const perGigUsdAmount = args.price;
  const quantity = args.quantity || 1;
  const description = args._.slice(1).join(" ").trim();
  const wallet = args.wallet;
  const minFollowers = args["min-followers"] ? parseInt(String(args["min-followers"]), 10) : undefined;
  const requirePremium = !!args["require-premium"];
  const minAccountAge = args["min-account-age"] ? parseInt(String(args["min-account-age"]), 10) : undefined;

  if (!perGigUsdAmount || !description || !wallet) {
    console.error('Usage: moltycash gig create "<description>" --price <USDC> --wallet <name> [--quantity <n>]');
    console.error('\nExample: moltycash gig create "Take a photo of your local coffee shop" --price 0.1 --quantity 10 --wallet agent-treasury');
    process.exit(1);
  }

  let amount: number;
  let perPostPrice: number;
  try {
    perPostPrice = parseAmount(String(perGigUsdAmount));
    const qty = parseInt(String(quantity), 10);
    if (isNaN(qty) || qty < 1) throw new Error("Quantity must be a positive integer");
    if (perPostPrice <= 0) throw new Error("Per-gig USD amount must be greater than 0");
    amount = perPostPrice * qty;
  } catch (error: any) {
    console.error(`\u274c ${error.message}`);
    process.exit(1);
  }

  if (description.length > 500) {
    console.error(`\u274c Description too long (${description.length} chars). Max 500 characters.`);
    process.exit(1);
  }

  assertSpendAllowed(amount);
  ensureOws();

  const totalSlots = Math.floor(amount / perPostPrice);
  const gigParams: Record<string, unknown> = {
    price: perPostPrice,
    quantity: totalSlots,
    description,
    ...(identityToken && { identity_token: identityToken }),
  };
  if (minFollowers !== undefined) gigParams.min_followers = minFollowers;
  if (requirePremium) gigParams.require_premium = true;
  if (minAccountAge !== undefined) gigParams.min_account_age_days = minAccountAge;

  console.log(`\n\u{1F3AF} Creating gig: ${totalSlots} slot(s) at ${perPostPrice} USDC each (total: ${amount} USDC)`);
  console.log(`   Wallet: ${wallet}`);
  console.log(`   Description: ${description}`);
  if (minFollowers !== undefined) console.log(`   Min followers: ${minFollowers}`);
  if (requirePremium) console.log(`   Require premium: yes`);
  if (minAccountAge !== undefined) console.log(`   Min account age: ${minAccountAge} days`);
  console.log();

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "gig.create",
    params: gigParams,
  };

  const output = owsPayRequest(`${baseURL}/a2a`, body, String(wallet));

  const lines = output.split("\n");
  const jsonLine = lines.find((l) => l.startsWith("{"));
  if (jsonLine) {
    const parsed = JSON.parse(jsonLine);
    // Check for failed task state
    if (parsed.result?.status?.state === "failed") {
      const errorParts = parsed.result.status?.message?.parts || [];
      const errorMsg = errorParts.filter((p: any) => p.kind === "text").map((p: any) => p.text).join("\n");
      throw new Error(errorMsg || "Gig creation failed");
    }
    if (parsed.result) {
      const r = parsed.result;
      // Try direct fields first, then check artifacts, then metadata
      let gig: any = null;
      if (r.gig_id) {
        gig = r;
      } else if (r.artifacts) {
        for (const a of r.artifacts) {
          if (a.data) {
            try { gig = JSON.parse(Buffer.from(a.data, "base64").toString()); break; } catch {}
          }
        }
      }
      if (!gig) {
        gig = r.status?.message?.metadata || {};
      }

      console.log(`\u2705 Gig created!`);
      if (gig.gig_id) {
        console.log(`   ID: ${gig.gig_id}`);
        console.log(`   URL: https://molty.cash/gig/${gig.gig_id}`);
      }
      if (gig.total_slots) console.log(`   Slots: ${gig.total_slots}`);
      if (gig.per_post_price) console.log(`   Per post: ${gig.per_post_price} USDC`);
      recordSpend(amount);
      return;
    }
    if (parsed.error) {
      throw new Error(parsed.error.message || "Gig creation failed");
    }
  }

  console.log(output);
}

async function handleCreated(): Promise<void> {
  console.log("\n\u{1F4CB} Fetching your created gigs...\n");

  const result = await a2aCall("gig.my_created", {});

  const gigs = result.gigs || [];
  if (gigs.length === 0) {
    console.log("No gigs created yet.");
    return;
  }

  console.log(`Found ${gigs.length} gig(s):\n`);
  for (const b of gigs) {
    const statusIcon = b.status === "open" ? "\u{1F7E2}" : b.status === "completed" ? "\u2705" : "\u23F0";
    console.log(`  ${statusIcon} ${b.id} [${b.status}]`);
    console.log(`     ${b.description}`);
    console.log(`     ${b.amount} USDC (${b.per_post_price}/post) \u2014 ${b.completed_slots}/${b.total_slots} completed`);
    console.log(`     Deadline: ${b.deadline}`);
    console.log();
  }
  console.log(`Use 'moltycash gig get <gig_id>' for full details.`);
}

async function handleGet(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 2) {
    console.error("Usage: moltycash gig get <gig_id>");
    process.exit(1);
  }

  const gigId = args._[1];
  console.log(`\n\u{1F4CB} Fetching gig ${gigId}...\n`);

  const result = await a2aCall("gig.get", { gig_id: gigId });

  const statusIcon = result.status === "open" ? "\u{1F7E2}" : result.status === "completed" ? "\u2705" : "\u23F0";
  console.log(`${statusIcon} ${result.id} [${result.status}]`);
  console.log(`   Description: ${result.description}`);
  console.log(`   Amount: ${result.amount} USDC (${result.per_post_price} per post)`);
  console.log(`   Slots: ${result.completed_slots} completed / ${result.assigned_slots} assigned / ${result.total_slots} total`);
  console.log(`   Remaining: ${result.remaining_slots}`);
  console.log(`   Network: ${result.payment_network}`);
  console.log(`   Deadline: ${result.deadline}`);
  console.log(`   Created: ${result.created_at}`);
  if (result.settlement_txn_hash) {
    console.log(`   TXN: ${result.settlement_txn_hash}`);
  }

  const assignments = result.assignments || [];
  if (assignments.length > 0) {
    console.log(`\n   Assignments (${assignments.length}):`);
    for (const a of assignments) {
      const icon = a.status === "completed" ? "\u2705"
        : a.status === "approved" ? "\u23F3"
        : a.status === "pending_review" ? "\u{1F50D}"
        : a.status === "assigned" ? "\u{1F512}"
        : a.status === "rejected" ? "\u274c"
        : a.status === "final_rejected" ? "\u26D4"
        : a.status === "disputed" ? "\u26A0\uFE0F"
        : "\u2022";
      console.log(`     ${icon} @${a.earner} \u2014 ${a.status} \u2014 ${a.amount} USDC`);
      if (a.proof) {
        console.log(`        Proof: ${a.proof}`);
      }
      if (a.ai_review_result?.reason) {
        console.log(`        AI: ${a.ai_review_result.reason}`);
      }
      if (a.status === "assigned" && a.assignment_deadline) {
        console.log(`        Submit by: ${a.assignment_deadline}`);
      }
    }
  } else {
    console.log(`\n   No assignments yet.`);
  }
  console.log();
}

async function handleReview(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 4) {
    console.error('Usage: moltycash gig review <gig_id> <assignment_id> <approve|reject> ["reason"]');
    console.error('\nExample: moltycash gig review ppp_123 asgn_abc approve');
    console.error('Example: moltycash gig review ppp_123 asgn_abc reject "Does not match the gig description"');
    process.exit(1);
  }

  const gigId = args._[1];
  const assignmentId = args._[2];
  const action = args._[3];
  const reason = args._[4] || undefined;

  if (!["approve", "reject"].includes(action)) {
    console.error(`\u274c Action must be 'approve' or 'reject', got '${action}'`);
    process.exit(1);
  }

  console.log(`\n\u2696\uFE0F  Reviewing assignment ${assignmentId} on gig ${gigId}...`);
  console.log(`   Action: ${action}`);
  if (reason) console.log(`   Reason: ${reason}`);
  console.log();

  const result = await a2aCall("gig.review", {
    gig_id: gigId,
    assignment_id: assignmentId,
    action,
    ...(reason && { reason }),
  });

  console.log(`\u2705 Review submitted!`);
  console.log(`   Assignment: ${result.assignment_id}`);
  console.log(`   Status: ${result.status}`);
  if (result.message) {
    console.log(`   ${result.message}`);
  }
}

// ───── Earner subcommands ─────

async function handleList(): Promise<void> {
  console.log("\n\u{1F4CB} Fetching available gigs...\n");
  const result = await a2aCall("gig.list", {});

  if (!result.eligible) {
    console.log(`\u274c Not eligible: ${result.reason}`);
    return;
  }

  const gigs = result.gigs || [];
  if (gigs.length === 0) {
    console.log("No open gigs available.");
    return;
  }

  console.log(`Found ${gigs.length} gig(s):\n`);
  for (const g of gigs) {
    console.log(`  \u{1F7E2} ${g.id}`);
    console.log(`     ${g.description}`);
    console.log(`     ${g.per_post_price} USDC/post \u2014 ${g.remaining_slots} slot(s) left`);
    console.log(`     Deadline: ${g.deadline}`);
    console.log();
  }
  console.log(`Use 'moltycash gig pick <gig_id>' to reserve a slot.`);
}

async function handlePick(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 2) {
    console.error("Usage: moltycash gig pick <gig_id>");
    process.exit(1);
  }

  const gigId = args._[1];
  console.log(`\n\u{1F3AF} Picking gig ${gigId}...\n`);
  const result = await a2aCall("gig.pick", { gig_id: gigId });

  console.log(`\u2705 Slot reserved!`);
  console.log(`   Assignment: ${result.assignment_id}`);
  console.log(`   Gig: ${result.gig_id}`);
  console.log(`   Submit proof by: ${result.assignment_deadline}`);
  console.log(`   Remaining slots: ${result.remaining_slots}`);
}

async function handleSubmit(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3) {
    console.error("Usage: moltycash gig submit <gig_id> <proof_url>");
    process.exit(1);
  }

  const gigId = args._[1];
  const proof = args._[2];
  console.log(`\n\u{1F4E4} Submitting proof for gig ${gigId}...\n`);
  const result = await a2aCall("gig.submit_proof", { gig_id: gigId, proof });

  console.log(`\u2705 Proof submitted!`);
  console.log(`   Assignment: ${result.assignment_id}`);
  console.log(`   Status: ${result.status}`);
  if (result.message) console.log(`   ${result.message}`);
}

async function handlePicked(): Promise<void> {
  console.log("\n\u{1F4CB} Fetching your picked gigs...\n");
  const result = await a2aCall("gig.my_accepted", {});

  const assignments = result.assignments || [];
  if (assignments.length === 0) {
    console.log("No picked gigs.");
    return;
  }

  console.log(`Found ${assignments.length} gig(s):\n`);
  for (const a of assignments) {
    const icon = a.status === "completed" ? "\u2705"
      : a.status === "approved" ? "\u23F3"
      : a.status === "pending_review" ? "\u{1F50D}"
      : a.status === "assigned" ? "\u{1F512}"
      : a.status === "rejected" ? "\u274c"
      : a.status === "final_rejected" ? "\u26D4"
      : a.status === "disputed" ? "\u26A0\uFE0F"
      : "\u2022";
    console.log(`  ${icon} ${a.assignment_id} [${a.status}]`);
    console.log(`     Gig: ${a.gig_id} \u2014 ${a.description}`);
    console.log(`     ${a.per_post_price} USDC`);
    if (a.payment_releases_at) console.log(`     Payment releases: ${a.payment_releases_at}`);
    if (a.approved_at) console.log(`     Approved: ${a.approved_at}`);
    if (a.submitted_at) console.log(`     Submitted: ${a.submitted_at}`);
    if (a.assignment_deadline) console.log(`     Deadline: ${a.assignment_deadline}`);
    if (a.message) console.log(`     ${a.message}`);
    console.log();
  }
}

async function handleDisputeEarner(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 4) {
    console.error('Usage: moltycash gig dispute <gig_id> <assignment_id> "reason"');
    process.exit(1);
  }

  const gigId = args._[1];
  const assignmentId = args._[2];
  const reason = args._.slice(3).join(" ");

  console.log(`\n\u2696\uFE0F  Disputing assignment ${assignmentId} on gig ${gigId}...\n`);
  const result = await a2aCall("gig.earner_dispute", { gig_id: gigId, assignment_id: assignmentId, reason });

  console.log(`\u2705 Dispute resolved!`);
  console.log(`   Assignment: ${result.assignment_id}`);
  console.log(`   Status: ${result.status}`);
  if (result.message) console.log(`   ${result.message}`);
}

// ───── Main ─────

const args = minimist(process.argv.slice(2));

const subcommand = args._[0];

if (!subcommand) {
  console.error("Usage: moltycash gig <create|created|get|review|list|pick|submit|picked|dispute>");
  process.exit(1);
}

// Identity token required for non-create commands (create uses OWS wallet directly)
if (subcommand !== "create" && !identityToken) {
  console.error("\u274c No identity token found.");
  console.error("   Gig commands require an identity token.");
  console.error("   Get yours at: https://molty.cash (Settings > Identity Token)");
  console.error("   Then run: moltycash wallet import-token <your_token>");
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    switch (subcommand) {
      case "create":
        await handleCreate(args);
        break;
      case "created":
        await handleCreated();
        break;
      case "get":
        await handleGet(args);
        break;
      case "review":
        await handleReview(args);
        break;
      case "list":
        await handleList();
        break;
      case "pick":
        await handlePick(args);
        break;
      case "submit":
        await handleSubmit(args);
        break;
      case "picked":
        await handlePicked();
        break;
      case "dispute":
        await handleDisputeEarner(args);
        break;
      default:
        console.error(`\u274c Unknown subcommand: ${subcommand}`);
        console.error("Available: create, created, get, review, list, pick, submit, picked, dispute");
        process.exit(1);
    }
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.response?.data?.msg || error.message;
    console.error(`\u274c ${errMsg || "Command failed"}`);
    if (error.response) {
      console.error("   Status:", error.response.status);
    }
    process.exit(1);
  }
}

main();
