import "dotenv/config";
import minimist from "minimist";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

const privateKey = process.env.EVM_PRIVATE_KEY as Hex;
const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.molty.cash";
const identityToken = process.env.MOLTY_IDENTITY_TOKEN as string | undefined;

const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

let rpcIdCounter = 1;

/**
 * Parse amount from various formats:
 * - "50¢" -> 0.50
 * - "$0.5" or "$0.50" -> 0.50
 * - "0.5" -> 0.50
 */
function parseAmount(amountStr: string): number {
  const trimmed = amountStr.trim();

  if (trimmed.endsWith("¢")) {
    const cents = parseFloat(trimmed.slice(0, -1));
    if (isNaN(cents)) {
      throw new Error(`Invalid cents amount: ${amountStr}`);
    }
    return cents / 100;
  }

  if (trimmed.startsWith("$")) {
    const dollarPart = trimmed.slice(1);
    if (/^\d+$/.test(dollarPart)) {
      const dollars = parseInt(dollarPart, 10);
      const cents = dollars * 100;
      throw new Error(
        `Dollar amounts like $${dollars} can be interpreted as shell variables. Please use ${cents}¢ instead.`,
      );
    }
    const dollars = parseFloat(dollarPart);
    if (isNaN(dollars)) {
      throw new Error(`Invalid dollar amount: ${amountStr}`);
    }
    return dollars;
  }

  const amount = parseFloat(trimmed);
  if (isNaN(amount)) {
    throw new Error(`Invalid amount: ${amountStr}`);
  }
  return amount;
}

/**
 * Send A2A JSON-RPC 2.0 request
 */
async function a2aCall(
  method: string,
  params: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
    ...extraHeaders,
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

// ───── Subcommands ─────

async function handleCreate(args: minimist.ParsedArgs): Promise<void> {
  const perGigUsdAmount = args.price;
  const quantity = args.quantity || 1;
  const condition = args._.slice(1).join(" ").trim();

  if (!perGigUsdAmount || !condition) {
    console.error('Usage: moltycash gig create "<condition>" --price <value> [--quantity <n>] [--network <base|solana>]');
    console.error('\nExample: moltycash gig create "Take a photo of your local coffee shop" --price 0.1 --quantity 10 --network base');
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

  if (condition.length > 500) {
    console.error(`\u274c Condition too long (${condition.length} chars). Max 500 characters.`);
    process.exit(1);
  }

  // Setup x402 signer
  const hasEvmKey = !!privateKey;
  const hasSvmKey = !!svmPrivateKey;
  let useSolana: boolean;

  if (args.network) {
    if (!["base", "solana"].includes(args.network.toLowerCase())) {
      console.error("Network must be either 'base' or 'solana'");
      process.exit(1);
    }
    useSolana = args.network.toLowerCase() === "solana";
    if (useSolana && !hasSvmKey) {
      console.error("\u274c Missing SVM_PRIVATE_KEY environment variable (needed for --network solana)");
      process.exit(1);
    }
    if (!useSolana && !hasEvmKey) {
      console.error("\u274c Missing EVM_PRIVATE_KEY environment variable (needed for --network base)");
      process.exit(1);
    }
  } else {
    if (hasEvmKey && hasSvmKey) {
      console.error("\u274c Both EVM_PRIVATE_KEY and SVM_PRIVATE_KEY are set");
      console.error("   Please specify which network to use with --network <base|solana>");
      process.exit(1);
    } else if (hasSvmKey) {
      useSolana = true;
      console.log("\u2139\ufe0f  Auto-detected network: Solana");
    } else if (hasEvmKey) {
      useSolana = false;
      console.log("\u2139\ufe0f  Auto-detected network: Base");
    } else {
      console.error("\u274c No private keys found");
      console.error("   Set EVM_PRIVATE_KEY (for Base) or SVM_PRIVATE_KEY (for Solana)");
      process.exit(1);
    }
  }

  const client = new x402Client();

  if (useSolana!) {
    console.log("\n\ud83d\udd27 Creating Solana signer...");
    const privateKeyBytes = bs58.decode(svmPrivateKey);
    const solanaSigner = await createKeyPairSignerFromBytes(privateKeyBytes);
    console.log(`\u2705 Solana signer created: ${solanaSigner.address}`);
    registerExactSvmScheme(client, { signer: solanaSigner });
  } else {
    console.log("\n\ud83d\udd27 Creating Base signer...");
    if (!privateKey.startsWith("0x")) {
      console.error("\u274c EVM_PRIVATE_KEY must start with '0x'");
      process.exit(1);
    }
    const account = privateKeyToAccount(privateKey);
    console.log(`\u2705 Base signer created: ${account.address}`);
    registerExactEvmScheme(client, { signer: account });
  }

  const totalSlots = Math.floor(amount / perPostPrice);
  console.log(`\n\ud83c\udfaf Creating gig: ${totalSlots} slot(s) at ${perPostPrice} USDC each (total: ${amount} USDC)`);
  console.log(`   Network: ${useSolana! ? "Solana" : "Base"}`);
  console.log(`   Condition: ${condition}`);
  console.log();

  // Phase 1: Get payment requirements
  console.log("\ud83d\udcb3 Phase 1: Requesting payment requirements...");
  const phase1Result = await a2aCall(
    "gig.create",
    { amount, per_post_price: perPostPrice, condition },
    { "X-A2A-Extensions": X402_EXTENSION_URI },
  );

  if (!phase1Result.id) {
    throw new Error("Missing task ID in response");
  }

  const paymentRequired = phase1Result.status?.message?.metadata?.["x402.payment.required"];
  if (!paymentRequired) {
    throw new Error("No payment requirements found in response");
  }

  // Phase 2: Sign and submit payment
  console.log("\ud83d\udd10 Phase 2: Signing payment...");
  const signedPayment = await client.createPaymentPayload(paymentRequired);

  console.log("\ud83d\udce4 Submitting signed payment...\n");
  const phase2Result = await a2aCall(
    "gig.create",
    {
      amount,
      per_post_price: perPostPrice,
      condition,
      taskId: phase1Result.id,
      payment: signedPayment,
    },
    { "X-A2A-Extensions": X402_EXTENSION_URI },
  );

  // Extract gig details from completed task artifacts
  const artifacts = phase2Result.artifacts || [];
  for (const artifact of artifacts) {
    if (artifact.data) {
      try {
        const data = JSON.parse(Buffer.from(artifact.data, "base64").toString());
        console.log(`\u2705 Gig created!`);
        console.log(`   ID: ${data.gig_id || data.bounty_id}`);
        console.log(`   Slots: ${data.total_slots}`);
        console.log(`   Per post: ${data.per_post_price} USDC`);
        console.log(`   Condition: ${data.condition}`);
        console.log(`   Deadline: ${data.deadline}`);
        if (data.transaction_hash) {
          console.log(`   TXN: ${data.transaction_hash}`);
        }
        return;
      } catch {
        // ignore parse errors
      }
    }
  }

  // Fallback: print status message
  const msg = phase2Result.status?.message?.parts
    ?.filter((p: any) => p.kind === "text")
    .map((p: any) => p.text)
    .join("\n");
  console.log(`\u2705 ${msg || "Gig created"}`);
}

async function handleMyGigs(): Promise<void> {
  console.log("\n\ud83d\udccb Fetching your gigs...\n");

  const result = await a2aCall("gig.my_created", {});

  const gigs = result.bounties || result.gigs || [];
  if (gigs.length === 0) {
    console.log("No gigs created yet.");
    return;
  }

  console.log(`Found ${gigs.length} gig(s):\n`);
  for (const b of gigs) {
    const statusIcon = b.status === "open" ? "\ud83d\udfe2" : b.status === "completed" ? "\u2705" : "\u23f0";
    console.log(`  ${statusIcon} ${b.id} [${b.status}]`);
    console.log(`     ${b.condition}`);
    console.log(`     ${b.amount} USDC (${b.per_post_price}/post) \u2014 ${b.claimed_slots}/${b.total_slots} claimed`);
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
  console.log(`\n\ud83d\udccb Fetching gig ${gigId}...\n`);

  const result = await a2aCall("gig.get", { gig_id: gigId });

  const statusIcon = result.status === "open" ? "\ud83d\udfe2" : result.status === "completed" ? "\u2705" : "\u23f0";
  console.log(`${statusIcon} ${result.id} [${result.status}]`);
  console.log(`   Condition: ${result.condition}`);
  console.log(`   Amount: ${result.amount} USDC (${result.per_post_price} per post)`);
  console.log(`   Slots: ${result.claimed_slots} claimed / ${result.assigned_slots} assigned / ${result.total_slots} total`);
  console.log(`   Remaining: ${result.remaining_slots}`);
  console.log(`   Network: ${result.payment_network}`);
  console.log(`   Deadline: ${result.deadline}`);
  console.log(`   Created: ${result.created_at}`);
  if (result.settlement_txn_hash) {
    console.log(`   TXN: ${result.settlement_txn_hash}`);
  }

  const claims = result.claims || [];
  if (claims.length > 0) {
    console.log(`\n   Claims (${claims.length}):`);
    for (const c of claims) {
      const claimIcon = c.status === "completed" ? "\u2705"
        : c.status === "approved" ? "\u23f3"
        : c.status === "assigned" ? "\ud83d\udd12"
        : c.status === "rejected" ? "\u274c"
        : c.status === "disputed" ? "\u26a0\ufe0f"
        : "\u2022";
      console.log(`     ${claimIcon} @${c.claimer_molty} \u2014 ${c.status} \u2014 ${c.amount} USDC`);
      if (c.proof) {
        console.log(`        Proof: ${c.proof}`);
      }
      if (c.ai_review_result?.reason) {
        console.log(`        AI: ${c.ai_review_result.reason}`);
      }
      if (c.status === "assigned" && c.assignment_deadline) {
        console.log(`        Submit by: ${c.assignment_deadline}`);
      }
    }
  } else {
    console.log(`\n   No claims yet.`);
  }
  console.log();
}

async function handleDispute(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3) {
    console.error('Usage: moltycash gig dispute <gig_id> <claim_id> ["reason"]');
    console.error('\nExample: moltycash gig dispute ppp_123 claim_abc "Proof does not match the task"');
    process.exit(1);
  }

  const gigId = args._[1];
  const claimId = args._[2];
  const reason = args._[3] || "Payer disputes this claim";

  console.log(`\n\u26a0\ufe0f  Disputing claim ${claimId} on gig ${gigId}...`);
  console.log(`   Reason: ${reason}\n`);

  const result = await a2aCall("gig.dispute", {
    gig_id: gigId,
    claim_id: claimId,
    reason,
  });

  console.log(`\u2705 Dispute submitted!`);
  console.log(`   Claim: ${result.claim_id}`);
  console.log(`   Status: ${result.status}`);
  if (result.message) {
    console.log(`   ${result.message}`);
  }
}

async function handleResolve(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 4) {
    console.error("Usage: moltycash gig resolve <gig_id> <claim_id> <approve|reject>");
    console.error('\nExample: moltycash gig resolve ppp_123 claim_abc approve');
    process.exit(1);
  }

  const gigId = args._[1];
  const claimId = args._[2];
  const action = args._[3];

  if (!["approve", "reject"].includes(action)) {
    console.error(`\u274c Action must be 'approve' or 'reject', got '${action}'`);
    process.exit(1);
  }

  console.log(`\n\u2696\ufe0f  Resolving claim ${claimId} on gig ${gigId}...`);
  console.log(`   Action: ${action}\n`);

  const result = await a2aCall("gig.resolve", {
    gig_id: gigId,
    claim_id: claimId,
    action,
  });

  console.log(`\u2705 Dispute resolved!`);
  console.log(`   Claim: ${result.claim_id}`);
  console.log(`   Status: ${result.status}`);
  if (result.message) {
    console.log(`   ${result.message}`);
  }
}

async function handleDisputes(): Promise<void> {
  console.log("\n\u26a0\ufe0f  Fetching disputed claims...\n");

  const result = await a2aCall("gig.disputes", {});

  const disputes = result.disputes || [];
  if (disputes.length === 0) {
    console.log("No disputed claims.");
    return;
  }

  console.log(`Found ${disputes.length} disputed claim(s):\n`);
  for (const d of disputes) {
    console.log(`  \u26a0\ufe0f  Gig: ${d.gig_id} \u2014 Claim: ${d.claim_id}`);
    console.log(`     Condition: ${d.condition}`);
    console.log(`     Claimer: @${d.claimer_molty}`);
    console.log(`     Amount: ${d.amount} USDC`);
    if (d.proof) {
      console.log(`     Proof: ${d.proof}`);
    }
    if (d.ai_review_result?.reason) {
      console.log(`     AI reason: ${d.ai_review_result.reason}`);
    }
    if (d.dispute_reason) {
      console.log(`     Dispute reason: ${d.dispute_reason}`);
    }
    if (d.dispute_deadline) {
      console.log(`     Deadline: ${d.dispute_deadline}`);
    }
    console.log();
  }
  console.log(`Resolve with: moltycash gig resolve <gig_id> <claim_id> <approve|reject>`);
}

// ───── Main ─────

const args = minimist(process.argv.slice(2));

if (!identityToken) {
  console.error("\u274c Missing MOLTY_IDENTITY_TOKEN environment variable");
  console.error("   All gig commands require an identity token.");
  console.error("   Get yours at: https://molty.cash (Profile > Identity Token)");
  process.exit(1);
}

const subcommand = args._[0];

if (!subcommand) {
  console.error("Usage: moltycash gig <create|my-gigs|get|dispute|disputes|resolve>");
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    switch (subcommand) {
      case "create":
        await handleCreate(args);
        break;
      case "my-gigs":
        await handleMyGigs();
        break;
      case "get":
        await handleGet(args);
        break;
      case "dispute":
        await handleDispute(args);
        break;
      case "disputes":
        await handleDisputes();
        break;
      case "resolve":
        await handleResolve(args);
        break;
      default:
        console.error(`\u274c Unknown subcommand: ${subcommand}`);
        console.error("Available: create, my-gigs, get, dispute, disputes, resolve");
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
