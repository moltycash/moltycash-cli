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
import { Mppx } from "@stellar/mpp/charge/client";
import { captureSessionFromResult } from "./lib/session.js";
import { buildExplorerUrl as sharedBuildExplorerUrl } from "./lib/explorer.js";
import { stellar } from "@stellar/mpp/charge/client";
import { tempo } from "mppx/client";
import { monad } from "@monad-crypto/mpp/client";

const privateKey = process.env.EVM_PRIVATE_KEY as Hex;
const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const stellarSecretKey = process.env.STELLAR_SECRET_KEY as string;
const tempoPrivateKey = process.env.TEMPO_PRIVATE_KEY as Hex;
const monadPrivateKey = process.env.MONAD_PRIVATE_KEY as Hex;
const worldchainPrivateKey = process.env.WORLDCHAIN_PRIVATE_KEY as Hex;
const skalePrivateKey = process.env.SKALE_PRIVATE_KEY as Hex;
const SKALE_CHAIN_ID = 1187947933;
const SKALE_NETWORK_ID = `eip155:${SKALE_CHAIN_ID}` as const;
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

type NetworkConfig =
  | { network: "base" | "solana" | "worldchain" | "skale"; client: any }
  | { network: "stellar" | "tempo" | "monad"; mppFetch: typeof globalThis.fetch };

async function setupNetwork(args: minimist.ParsedArgs): Promise<NetworkConfig> {
  const hasEvmKey = !!privateKey;
  const hasSvmKey = !!svmPrivateKey;
  const hasStellarKey = !!stellarSecretKey;
  const hasTempoKey = !!tempoPrivateKey;
  const hasMonadKey = !!monadPrivateKey;
  const hasWorldChainKey = !!worldchainPrivateKey;
  const hasSkaleKey = !!skalePrivateKey;
  const keyCount = [hasEvmKey, hasSvmKey, hasStellarKey, hasTempoKey, hasMonadKey, hasWorldChainKey, hasSkaleKey].filter(Boolean).length;

  let network: "base" | "solana" | "stellar" | "tempo" | "monad" | "worldchain" | "skale";

  if (args.network) {
    if (!["base", "solana", "stellar", "tempo", "monad", "worldchain", "skale"].includes(args.network.toLowerCase())) {
      console.error("Network must be 'base', 'solana', 'stellar', 'tempo', 'monad', 'worldchain', or 'skale'");
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
    if (network === "stellar" && !hasStellarKey) {
      console.error("❌ Missing STELLAR_SECRET_KEY environment variable (needed for --network stellar)");
      process.exit(1);
    }
    if (network === "tempo" && !hasTempoKey) {
      console.error("❌ Missing TEMPO_PRIVATE_KEY environment variable (needed for --network tempo)");
      process.exit(1);
    }
    if (network === "monad" && !hasMonadKey) {
      console.error("❌ Missing MONAD_PRIVATE_KEY environment variable (needed for --network monad)");
      process.exit(1);
    }
    if (network === "worldchain" && !hasWorldChainKey) {
      console.error("❌ Missing WORLDCHAIN_PRIVATE_KEY environment variable (needed for --network worldchain)");
      process.exit(1);
    }
    if (network === "skale" && !hasSkaleKey) {
      console.error("❌ Missing SKALE_PRIVATE_KEY environment variable (needed for --network skale)");
      process.exit(1);
    }
  } else {
    if (keyCount > 1) {
      console.error("❌ Multiple private keys found");
      console.error("   Please specify which network to use with --network <base|solana|stellar|tempo|monad|worldchain|skale>");
      process.exit(1);
    } else if (hasSkaleKey) {
      network = "skale";
      console.log("ℹ️  Auto-detected network: SKALE");
    } else if (hasWorldChainKey) {
      network = "worldchain";
      console.log("ℹ️  Auto-detected network: World Chain");
    } else if (hasMonadKey) {
      network = "monad";
      console.log("ℹ️  Auto-detected network: Monad");
    } else if (hasTempoKey) {
      network = "tempo";
      console.log("ℹ️  Auto-detected network: Tempo");
    } else if (hasStellarKey) {
      network = "stellar";
      console.log("ℹ️  Auto-detected network: Stellar");
    } else if (hasSvmKey) {
      network = "solana";
      console.log("ℹ️  Auto-detected network: Solana");
    } else if (hasEvmKey) {
      network = "base";
      console.log("ℹ️  Auto-detected network: Base");
    } else {
      console.error("❌ No private keys found");
      console.error("   Set EVM_PRIVATE_KEY (Base), SVM_PRIVATE_KEY (Solana), STELLAR_SECRET_KEY (Stellar), TEMPO_PRIVATE_KEY (Tempo), MONAD_PRIVATE_KEY (Monad), WORLDCHAIN_PRIVATE_KEY (World Chain), or SKALE_PRIVATE_KEY (SKALE)");
      process.exit(1);
    }
  }

  if (network === "monad") {
    console.log("\n🔧 Creating Monad signer...");
    const account = privateKeyToAccount(monadPrivateKey);
    console.log(`✅ Monad signer created: ${account.address}`);
    const mppClient = Mppx.create({
      methods: [monad.charge({ account })],
      polyfill: false,
    });
    return { network: "monad", mppFetch: mppClient.fetch };
  }

  if (network === "tempo") {
    console.log("\n🔧 Creating Tempo signer...");
    const account = privateKeyToAccount(tempoPrivateKey);
    console.log(`✅ Tempo signer created: ${account.address}`);
    const mppClient = Mppx.create({
      methods: [tempo.charge({ account })],
      polyfill: false,
    });
    return { network: "tempo", mppFetch: mppClient.fetch };
  }

  if (network === "stellar") {
    console.log("\n🔧 Creating Stellar signer...");
    const mppClient = Mppx.create({
      methods: [
        stellar.charge({
          secretKey: stellarSecretKey,
          onProgress: (event) => {
            if (event.type === "challenge") console.log(`   💰 ${event.amount} stroops → ${event.recipient}`);
            if (event.type === "signing") console.log("   🔐 Signing Soroban transaction...");
            if (event.type === "paying") console.log("   📤 Submitting payment...");
            if (event.type === "paid") console.log(`   ✅ Paid! Hash: ${event.hash}`);
          },
        }),
      ],
      polyfill: false,
    });
    console.log("✅ Stellar signer ready");
    return { network: "stellar", mppFetch: mppClient.fetch };
  }

  const client = new x402Client();

  if (network === "solana") {
    console.log("\n🔧 Creating Solana signer...");
    const privateKeyBytes = bs58.decode(svmPrivateKey);
    const solanaSigner = await createKeyPairSignerFromBytes(privateKeyBytes);
    console.log(`✅ Solana signer created: ${solanaSigner.address}`);
    registerExactSvmScheme(client, { signer: solanaSigner });
  } else if (network === "worldchain") {
    console.log("\n🔧 Creating World Chain signer...");
    if (!worldchainPrivateKey.startsWith("0x")) {
      console.error("❌ WORLDCHAIN_PRIVATE_KEY must start with '0x'");
      process.exit(1);
    }
    const account = privateKeyToAccount(worldchainPrivateKey);
    console.log(`✅ World Chain signer created: ${account.address}`);
    registerExactEvmScheme(client, {
      signer: account,
      networks: ["eip155:480"],
      paymentRequirementsSelector: (_ver: number, reqs: any[]) => reqs.find((r: any) => r.network === "eip155:480") || reqs[0],
    });
  } else if (network === "skale") {
    console.log("\n🔧 Creating SKALE signer...");
    if (!skalePrivateKey.startsWith("0x")) {
      console.error("❌ SKALE_PRIVATE_KEY must start with '0x'");
      process.exit(1);
    }
    const account = privateKeyToAccount(skalePrivateKey);
    console.log(`✅ SKALE signer created: ${account.address}`);
    registerExactEvmScheme(client, {
      signer: account,
      networks: [SKALE_NETWORK_ID],
      paymentRequirementsSelector: (_ver: number, reqs: any[]) => reqs.find((r: any) => r.network === SKALE_NETWORK_ID) || reqs[0],
    });
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

// Delegate to the shared helper in ./lib/explorer.ts. Kept as a thin wrapper so
// existing references in this file continue to compile.
const buildExplorerUrl = sharedBuildExplorerUrl;

// ─── MPP Helper ─────────────────────────────────────────────

async function mppCall(
  mppFetch: typeof globalThis.fetch,
  endpoint: string,
  method: string,
  params: Record<string, unknown>,
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });

  const response = await mppFetch(endpoint, {
    method: "POST",
    headers,
    body,
  });

  const data = await response.json() as any;

  if (data.error) {
    throw new Error(data.error.message || "Request failed");
  }

  return data.result;
}

// ─── Tip Subcommand ──────────────────────────────────────────

async function handleTip(args: minimist.ParsedArgs): Promise<void> {
  if (args._.length < 3) {
    console.error("Usage: moltycash human tip <username> <amount> [--network <base|solana|stellar>]");
    console.error("\nExamples:");
    console.error("  moltycash human tip 0xmesuthere 50¢");
    console.error("  moltycash human tip 0xmesuthere 100¢ --network solana");
    console.error("  moltycash human tip 0xmesuthere 50¢ --network stellar");
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
  }

  const networkConfig = await setupNetwork(args);
  const tipEndpoint = `${baseURL}/${username}/a2a`;

  console.log(`\n💸 Tipping @${username} ${amount} USDC...`);
  console.log(`   API: ${tipEndpoint}`);
  console.log(`   Network: ${networkConfig.network.charAt(0).toUpperCase() + networkConfig.network.slice(1)}`);
  if (identityToken) console.log(`   🔐 Sending as verified sender`);
  console.log();

  // MPP flow (Stellar, Tempo)
  if (networkConfig.network === "stellar" || networkConfig.network === "tempo" || networkConfig.network === "monad") {
    const result = await mppCall(
      networkConfig.mppFetch,
      tipEndpoint,
      "tip",
      { amount },
    );

    console.log(`✅ ${result.amount || amount} USDC sent to @${result.to || username}`);
    const explorerUrl = result.transaction?.explorer || buildExplorerUrl(result.transaction_hash, result.network);
    if (explorerUrl) console.log(`🔗 ${explorerUrl}`);
    if (result.receipt) console.log(`📄 ${result.receipt}`);
    captureSessionFromResult(result);
    if (result.session_token) console.log(`🔑 Session token cached — reward.balance / reward.claim ready for 24h`);
    return;
  }

  // x402 flow (Base/Solana)
  const { client } = networkConfig as { network: "base" | "solana"; client: any };
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-A2A-Extensions": X402_EXTENSION_URI,
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const tipParams: Record<string, unknown> = { amount };

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
  captureSessionFromResult(result);

  // Try artifacts first
  const artifacts = result.artifacts || [];
  for (const artifact of artifacts) {
    if (artifact.data) {
      try {
        const data = JSON.parse(Buffer.from(artifact.data, "base64").toString());
        console.log(`✅ ${data.amount || amount} USDC sent to @${data.to || username}`);
        const explorerUrl = data.transaction?.explorer || buildExplorerUrl(data.transaction_hash, data.network);
        if (explorerUrl) console.log(`🔗 ${explorerUrl}`);
        if (data.receipt) console.log(`📄 ${data.receipt}`);
        if (data.session_token) console.log(`🔑 Session token cached — reward.balance / reward.claim ready for 24h`);
        return;
      } catch {
        // ignore parse errors
      }
    }
  }

  // Fallback: check direct result fields
  if (result.type === 'tip' || result.to) {
    console.log(`✅ ${result.amount || amount} USDC sent to @${result.to || username}`);
    const explorerUrl = result.transaction?.explorer || buildExplorerUrl(result.transaction_hash, result.network);
    if (explorerUrl) console.log(`🔗 ${explorerUrl}`);
    if (result.receipt) console.log(`📄 ${result.receipt}`);
    if (result.session_token) console.log(`🔑 Session token cached — reward.balance / reward.claim ready for 24h`);
    return;
  }

  // Fallback: check payment receipts in metadata
  const receipts = result.status?.message?.metadata?.["x402.payment.receipts"];
  if (receipts?.[0]?.transaction) {
    const r = receipts[0];
    const network = r.network?.includes('solana') ? 'solana' : r.network?.includes('stellar') ? 'stellar' : r.network?.includes('4217') ? 'tempo' : 'base';
    console.log(`✅ ${amount} USDC sent to @${username}`);
    const explorerUrl = buildExplorerUrl(r.transaction, network);
    if (explorerUrl) console.log(`🔗 ${explorerUrl}`);
    return;
  }

  const msg = result.status?.message?.parts
    ?.filter((p: any) => p.kind === "text")
    .map((p: any) => p.text)
    .join("\n");
  console.log(`✅ ${msg || `${amount} USDC sent to @${username}`}`);
}

// ─── Hire Subcommand ─────────────────────────────────────────

async function handleHire(args: minimist.ParsedArgs): Promise<void> {
  // Unified hire shape. Two payout models:
  //
  // Fixed (default):
  //   hire <username> "<description>" --amount <USD> --service <svc> --product-type <type>
  //
  // Performance (CPM campaign dedicated to the earner):
  //   hire <username> "<description>" --amount <USD> --payout-model performance
  //     --cpm <rate> --max-payout <cap> [--payout-chain solana|base]
  //     [--token-contract <addr>] [--ticker <symbol>]

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

  // MPP flow (Stellar, Tempo)
  if (networkConfig.network === "stellar" || networkConfig.network === "tempo" || networkConfig.network === "monad") {
    const result = await mppCall(
      networkConfig.mppFetch,
      hireEndpoint,
      "hire",
      buildHireParams(),
    );

    printHireResult(result, username);
    return;
  }

  // x402 flow (Base/Solana)
  const { client } = networkConfig as { network: "base" | "solana"; client: any };
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
  console.error("Usage: moltycash human <tip|hire>");
  console.error("\nSubcommands:");
  console.error("  tip  <username> <amount>                                                                       Tip USDC");
  console.error('  hire <username> "<description>" --amount <USD> --service <svc> --product-type <type>          Fixed hire (escrow)');
  console.error('  hire <username> "<description>" --amount 1 --payout-model performance --cpm <rate> --max-payout <cap>  Performance hire (CPM)');
  console.error("\nExamples:");
  console.error("  moltycash human tip 0xmesuthere 50¢");
  console.error('  moltycash human hire 0xmesuthere "Write an X article on x402" --amount 7 --service x_paid_promotion --product-type x_article');
  console.error('  moltycash human hire 0xmesuthere "Shill our launch" --amount 1 --payout-model performance --cpm 0.001 --max-payout 10 --ticker MYTOKEN');
  console.error("Discover available products via the user's agent card:");
  console.error("  curl https://api.molty.cash/<username>/.well-known/agent-card.json");
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
