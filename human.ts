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
import { buildExplorerUrl as sharedBuildExplorerUrl } from "./lib/explorer.js";

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
  network: "base" | "solana";
  client: any;
}

async function setupNetwork(args: minimist.ParsedArgs): Promise<NetworkConfig> {
  const hasEvmKey = !!privateKey;
  const hasSvmKey = !!svmPrivateKey;
  const keyCount = [hasEvmKey, hasSvmKey].filter(Boolean).length;

  let network: "base" | "solana";

  if (args.network) {
    if (!["base", "solana"].includes(args.network.toLowerCase())) {
      console.error("Network must be 'base' or 'solana'");
      process.exit(1);
    }
    network = args.network.toLowerCase() as typeof network;

    if (network === "solana" && !hasSvmKey) {
      console.error("❌ Missing SVM_PRIVATE_KEY environment variable (needed for --network solana)");
      process.exit(1);
    }
    if (network === "base" && !hasEvmKey) {
      console.error("❌ Missing EVM_PRIVATE_KEY environment variable (needed for --network base)");
      process.exit(1);
    }
  } else {
    if (keyCount > 1) {
      console.error("❌ Multiple private keys found");
      console.error("   Please specify which network to use with --network <base|solana>");
      process.exit(1);
    } else if (hasSvmKey) {
      network = "solana";
      console.log("ℹ️  Auto-detected network: Solana");
    } else if (hasEvmKey) {
      network = "base";
      console.log("ℹ️  Auto-detected network: Base");
    } else {
      console.error("❌ No private keys found");
      console.error("   Set EVM_PRIVATE_KEY (Base) or SVM_PRIVATE_KEY (Solana)");
      process.exit(1);
    }
  }

  const client = new x402Client();

  if (network === "solana") {
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

  return { network, client };
}

// ─── Explorer URL Helper ─────────────────────────────────────

const buildExplorerUrl = sharedBuildExplorerUrl;

// ─── Hire Subcommand ─────────────────────────────────────────

async function handleHire(args: minimist.ParsedArgs): Promise<void> {
  const username = args._.length >= 2 ? String(args._[1]) : "";
  const positionalDescription = args._.length >= 3 ? args._.slice(2).join(" ").trim() : "";
  const flagDescription = args.description !== undefined ? String(args.description).trim() : "";
  const description = flagDescription || positionalDescription;

  const amountRaw = args.amount !== undefined ? args.amount : undefined;

  if (!username || !description || amountRaw === undefined) {
    console.error('Usage:');
    console.error('  moltycash human hire <username> "<description>" --amount <USD> --cpm <rate> --max-payout <cap> [--payout-chain solana|base] [--token-contract <addr>] [--ticker TOKEN]');
    console.error("\nExamples:");
    console.error('  moltycash human hire 0xmesuthere "Shill our token launch" --amount 1 --cpm 0.001 --max-payout 10 --ticker MYTOKEN');
    console.error('  moltycash human hire 0xmesuthere "Post about our launch on X" --amount 1 --cpm 5 --max-payout 50');
    process.exit(1);
  }

  if (description.length > 500) {
    console.error(`❌ Description too long (${description.length} chars). Max 500 characters.`);
    process.exit(1);
  }

  let amount: number;
  try {
    amount = parseAmount(String(amountRaw));
    if (amount <= 0) throw new Error("amount must be greater than 0");
    if (amount > 50) throw new Error("amount must be 50 USDC or less");
    if (amount < 1.0) throw new Error("hire requires amount >= 1.0 USDC (campaign creation fee)");
  } catch (e: any) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  const cpmRaw = args.cpm !== undefined ? Number(args.cpm) : NaN;
  const maxPayoutRaw = args["max-payout"] !== undefined ? Number(args["max-payout"]) : NaN;
  if (!Number.isFinite(cpmRaw) || cpmRaw <= 0) {
    console.error("❌ --cpm is required and must be > 0");
    process.exit(1);
  }
  if (!Number.isFinite(maxPayoutRaw) || maxPayoutRaw <= 0) {
    console.error("❌ --max-payout is required and must be > 0");
    process.exit(1);
  }
  const payoutChain = args["payout-chain"] ? String(args["payout-chain"]).toLowerCase() : "solana";
  if (payoutChain !== "solana" && payoutChain !== "base") {
    console.error('❌ --payout-chain must be "solana" or "base"');
    process.exit(1);
  }

  const perfFlags: Record<string, unknown> = {
    cpm_rate: cpmRaw,
    max_payout_per_submission: maxPayoutRaw,
    payout_chain: payoutChain,
    ...(args["token-contract"] ? { token_contract: String(args["token-contract"]) } : {}),
    ...(args.ticker ? { ticker: String(args.ticker) } : {}),
  };

  const networkConfig = await setupNetwork(args);
  const hireEndpoint = `${baseURL}/${username}/a2a`;

  console.log(`\n🎯 Hiring @${username}...`);
  console.log(`   API: ${hireEndpoint}`);
  console.log(`   Network: ${networkConfig.network.charAt(0).toUpperCase() + networkConfig.network.slice(1)}`);
  console.log(`   Task: ${description}`);
  console.log(`   💰 Amount: $${amount} USDC`);
  console.log(`   CPM: ${cpmRaw} ${args.ticker || 'token'} / 1K views`);
  console.log(`   Cap: ${maxPayoutRaw} ${args.ticker || 'token'} / post`);
  console.log(`   Payout chain: ${payoutChain}`);
  console.log();

  const buildHireParams = (): Record<string, unknown> => ({
    description,
    amount,
    ...perfFlags,
  });

  const { client } = networkConfig;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-A2A-Extensions": X402_EXTENSION_URI,
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const hireParams = buildHireParams();

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
        printHireResult(data, username);
        return;
      } catch {
        // ignore
      }
    }
  }

  // Fallback: check for direct result fields
  if (result.type === 'performance_hire' || result.type === 'hire' || result.gig_id) {
    printHireResult(result, username);
    return;
  }

  const msg = result.status?.message?.parts
    ?.filter((p: any) => p.kind === "text")
    .map((p: any) => p.text)
    .join("\n");
  console.log(`✅ ${msg || `@${username} hired`}`);
}

function printHireResult(result: any, username: string): void {
  if (result.type === 'performance_hire' || result.campaign_id) {
    console.log(`✅ Performance campaign created for @${result.to || username}`);
    console.log(`   Campaign ID: ${result.campaign_id}`);
    console.log(`   Fund wallet: ${result.wallet_address}`);
    console.log(`   Chain: ${result.payout_chain}`);
    console.log(`   Token: ${result.token_contract}`);
    if (result.ticker) console.log(`   Ticker: $${result.ticker}`);
    console.log(`   CPM: ${result.cpm_rate} ${result.ticker || 'token'} / 1K views`);
    console.log(`   Cap: ${result.max_payout_per_submission} ${result.ticker || 'token'} / post`);
    if (result.message) console.log(`\n💡 ${result.message}`);
    return;
  }
  console.log(`✅ @${result.to || username} hired for ${result.amount} USDC`);
  const explorerUrl = result.transaction?.explorer || buildExplorerUrl(result.transaction_hash, result.network);
  if (explorerUrl) console.log(`🔗 ${explorerUrl}`);
  if (result.receipt) console.log(`📄 ${result.receipt}`);
}

// ─── Main ────────────────────────────────────────────────────

const args = minimist(process.argv.slice(2));
const subcommand = args._[0];

if (!subcommand) {
  console.error("Usage: moltycash human <hire>");
  console.error("\nSubcommands:");
  console.error('  hire <username> "<description>" --amount 1 --cpm <rate> --max-payout <cap>  Performance hire (CPM)');
  console.error("\nExamples:");
  console.error('  moltycash human hire 0xmesuthere "Shill our launch" --amount 1 --cpm 0.001 --max-payout 10 --ticker MYTOKEN');
  process.exit(1);
}

async function main(): Promise<void> {
  try {
    switch (subcommand) {
      case "hire":
        await handleHire(args);
        break;
      default:
        console.error(`❌ Unknown subcommand: ${subcommand}`);
        console.error("Available: hire");
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
