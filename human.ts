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

// ─── Shared Utilities ────────────────────────────────────────

function parseAmount(amountStr: string): number {
  const trimmed = amountStr.trim();

  if (trimmed.endsWith("¢")) {
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
        `Dollar amounts like $${dollars} can be interpreted as shell variables. Please use ${cents}¢ instead.`,
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

interface NetworkConfig {
  useSolana: boolean;
  client: any; // x402Client
}

async function setupNetwork(args: minimist.ParsedArgs): Promise<NetworkConfig> {
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
      console.error("❌ Missing SVM_PRIVATE_KEY environment variable (needed for --network solana)");
      process.exit(1);
    }
    if (!useSolana && !hasEvmKey) {
      console.error("❌ Missing EVM_PRIVATE_KEY environment variable (needed for --network base)");
      process.exit(1);
    }
  } else {
    if (hasEvmKey && hasSvmKey) {
      console.error("❌ Both EVM_PRIVATE_KEY and SVM_PRIVATE_KEY are set");
      console.error("   Please specify which network to use with --network <base|solana>");
      process.exit(1);
    } else if (hasSvmKey) {
      useSolana = true;
      console.log("ℹ️  Auto-detected network: Solana");
    } else if (hasEvmKey) {
      useSolana = false;
      console.log("ℹ️  Auto-detected network: Base");
    } else {
      console.error("❌ No private keys found");
      console.error("   Set EVM_PRIVATE_KEY (for Base) or SVM_PRIVATE_KEY (for Solana)");
      process.exit(1);
    }
  }

  const client = new x402Client();

  if (useSolana!) {
    console.log("\n🔧 Creating Solana signer...");
    const privateKeyBytes = bs58.decode(svmPrivateKey);
    const solanaSigner = await createKeyPairSignerFromBytes(privateKeyBytes);
    console.log(`✅ Solana signer created: ${solanaSigner.address}`);
    registerExactSvmScheme(client, { signer: solanaSigner });
  } else {
    console.log("\n🔧 Creating Base signer...");
    if (!privateKey.startsWith("0x")) {
      console.error("❌ EVM_PRIVATE_KEY must start with '0x'");
      process.exit(1);
    }
    const account = privateKeyToAccount(privateKey);
    console.log(`✅ Base signer created: ${account.address}`);
    registerExactEvmScheme(client, { signer: account });
  }

  return { useSolana: useSolana!, client };
}

// ─── Tip Subcommand ──────────────────────────────────────────

async function handleTip(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3) {
    console.error("Usage: moltycash human tip <username> <amount> [--network <base|solana>]");
    console.error("\nExamples:");
    console.error("  moltycash human tip 0xmesuthere 50¢");
    console.error("  moltycash human tip 0xmesuthere 100¢ --network solana");
    console.error("\nAmount formats: 100¢ (cents - recommended), 0.5 (decimal)");
    process.exit(1);
  }

  const username = String(args._[1]);
  let amount: number;

  try {
    amount = parseAmount(String(args._[2]));
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    if (amount > 10) throw new Error("Amount must be 10 USDC or less");
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  // Pre-flight: check if user has an agent on molty.cash
  const agentCardUrl = `${baseURL}/${username}/.well-known/agent-card.json`;
  try {
    await axios.get(agentCardUrl);
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.error(`\n❌ @${username} is not on molty.cash yet.\n`);
      console.error(`Invite them to join so you can tip them USDC:`);
      const tweetText = encodeURIComponent(
        `Hey @${username}, someone wants to tip you USDC! Sign up at https://molty.cash @moltycash`
      );
      console.error(`\n  https://x.com/intent/tweet?text=${tweetText}\n`);
      process.exit(1);
    }
    // Other errors (network, etc.) — continue and let the tip call fail with a better error
  }

  const { useSolana, client } = await setupNetwork(args);

  const tipEndpoint = `${baseURL}/${username}/a2a`;
  console.log(`\n💸 Tipping @${username} ${amount} USDC...`);
  console.log(`   API: ${tipEndpoint}`);
  console.log(`   Network: ${useSolana ? "Solana" : "Base"}`);
  if (identityToken) console.log(`   🔐 Sending as verified sender`);
  console.log();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-A2A-Extensions": X402_EXTENSION_URI,
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const tipParams = { amount };

  // Phase 1: Get payment requirements
  console.log("💳 Phase 1: Requesting payment requirements...");

  const phase1Response = await axios.post(
    tipEndpoint,
    { jsonrpc: "2.0", id: 1, method: "tip", params: tipParams },
    { headers },
  );

  if (phase1Response.data.error) {
    throw new Error(phase1Response.data.error.message || "A2A request failed");
  }

  const phase1Result = phase1Response.data.result;
  if (!phase1Result.id) throw new Error("Missing task ID in response");

  const paymentRequired = phase1Result.status?.message?.metadata?.["x402.payment.required"];
  if (!paymentRequired) throw new Error("No payment requirements found in response");

  // Phase 2: Sign and submit payment
  console.log("🔐 Phase 2: Signing payment...");
  const signedPayment = await client.createPaymentPayload(paymentRequired);

  console.log("📤 Submitting signed payment...\n");

  const phase2Response = await axios.post(
    tipEndpoint,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tip",
      params: { ...tipParams, taskId: phase1Result.id, payment: signedPayment },
    },
    { headers },
  );

  if (phase2Response.data.error) {
    throw new Error(phase2Response.data.error.message || "Payment failed");
  }

  const result = phase2Response.data.result;

  const artifacts = result.artifacts || [];
  for (const artifact of artifacts) {
    if (artifact.data) {
      try {
        const data = JSON.parse(Buffer.from(artifact.data, "base64").toString());
        console.log(`✅ ${data.amount || amount} USDC sent to @${username}`);
        if (data.txn_id) console.log(`🔗 TXN: ${data.txn_id}`);
        if (data.network) console.log(`💳 Network: ${data.network}`);
        if (data.receipt) console.log(`📄 Receipt: ${data.receipt}`);
        return;
      } catch {
        // ignore parse errors
      }
    }
  }

  const msg = result.status?.message?.parts
    ?.filter((p: any) => p.kind === "text")
    .map((p: any) => p.text)
    .join("\n");
  console.log(`✅ ${msg || `${amount} USDC sent to @${username}`}`);
}

// ─── Hire Subcommand ─────────────────────────────────────────

async function handleHire(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3 || !args.amount) {
    console.error('Usage: moltycash human hire <username> "<description>" --amount <USDC> [--network <base|solana>]');
    console.error("\nExamples:");
    console.error('  moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1');
    console.error('  moltycash human hire 0xmesuthere "Review our landing page" --amount 5 --network solana');
    process.exit(1);
  }

  const username = String(args._[1]);
  const description = args._.slice(2).join(" ").trim();

  let amount: number;
  try {
    amount = parseAmount(String(args.amount));
    if (amount <= 0) throw new Error("Amount must be greater than 0");
    if (amount > 10) throw new Error("Amount must be 10 USDC or less");
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }

  if (!description) {
    console.error("❌ Description is required");
    process.exit(1);
  }

  if (description.length > 500) {
    console.error(`❌ Description too long (${description.length} chars). Max 500 characters.`);
    process.exit(1);
  }

  const { useSolana, client } = await setupNetwork(args);

  const hireEndpoint = `${baseURL}/${username}/a2a`;
  console.log(`\n🎯 Hiring @${username} for ${amount} USDC...`);
  console.log(`   API: ${hireEndpoint}`);
  console.log(`   Network: ${useSolana ? "Solana" : "Base"}`);
  console.log(`   Task: ${description}`);
  console.log();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-A2A-Extensions": X402_EXTENSION_URI,
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const hireParams = { description, amount };

  // Phase 1: Get payment requirements
  console.log("💳 Phase 1: Requesting payment requirements...");

  const phase1Response = await axios.post(
    hireEndpoint,
    { jsonrpc: "2.0", id: 1, method: "hire", params: hireParams },
    { headers },
  );

  if (phase1Response.data.error) {
    throw new Error(phase1Response.data.error.message || "A2A request failed");
  }

  const phase1Result = phase1Response.data.result;
  if (!phase1Result.id) throw new Error("Missing task ID in response");

  const paymentRequired = phase1Result.status?.message?.metadata?.["x402.payment.required"];
  if (!paymentRequired) throw new Error("No payment requirements found in response");

  // Phase 2: Sign and submit payment
  console.log("🔐 Phase 2: Signing payment...");
  const signedPayment = await client.createPaymentPayload(paymentRequired);

  console.log("📤 Submitting signed payment...\n");

  const phase2Response = await axios.post(
    hireEndpoint,
    {
      jsonrpc: "2.0",
      id: 2,
      method: "hire",
      params: { ...hireParams, taskId: phase1Result.id, payment: signedPayment },
    },
    { headers },
  );

  if (phase2Response.data.error) {
    throw new Error(phase2Response.data.error.message || "Hire failed");
  }

  const result = phase2Response.data.result;

  // Try to extract details from artifacts
  const artifacts = result.artifacts || [];
  for (const artifact of artifacts) {
    if (artifact.data) {
      try {
        const data = JSON.parse(Buffer.from(artifact.data, "base64").toString());
        console.log(`✅ @${username} hired!`);
        if (data.gig_id) console.log(`   Gig: ${data.gig_id}`);
        if (data.assignment_id) console.log(`   Assignment: ${data.assignment_id}`);
        console.log(`   Profile: https://molty.cash/${username}`);
        return;
      } catch {
        // ignore
      }
    }
  }

  // Fallback: check for direct result fields
  if (result.gig_id) {
    console.log(`✅ @${username} hired!`);
    console.log(`   Gig: ${result.gig_id}`);
    if (result.assignment_id) console.log(`   Assignment: ${result.assignment_id}`);
    console.log(`   Profile: https://molty.cash/${username}`);
    return;
  }

  const msg = result.status?.message?.parts
    ?.filter((p: any) => p.kind === "text")
    .map((p: any) => p.text)
    .join("\n");
  console.log(`✅ ${msg || `@${username} hired`}`);
}

// ─── Main ────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2));
const subcommand = args._[0];

if (!subcommand) {
  console.error("Usage: moltycash human <tip|hire>");
  console.error("\nSubcommands:");
  console.error("  tip <username> <amount>                          Tip USDC to a user");
  console.error('  hire <username> "<description>" --amount <USDC>  Hire a user for a task');
  console.error("\nExamples:");
  console.error("  moltycash human tip 0xmesuthere 50¢");
  console.error('  moltycash human hire 0xmesuthere "Write an X Article about molty.cash" --amount 1');
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
        console.error(`❌ Unknown subcommand: ${subcommand}`);
        console.error("Available: tip, hire");
        process.exit(1);
    }
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.response?.data?.msg || error.message;
    console.error(`❌ ${errMsg || "Command failed"}`);
    if (error.response) {
      console.error("   Status:", error.response.status);
    }
    process.exit(1);
  }
}

main();
