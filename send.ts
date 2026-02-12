import "dotenv/config";
import minimist from "minimist";
import axios from "axios";
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

const privateKey = process.env.EVM_PRIVATE_KEY as Hex;
const svmPrivateKey = process.env.SVM_PRIVATE_KEY as string;
const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.molty.cash";
const identityToken = process.env.MOLTY_IDENTITY_TOKEN as string | undefined;

/**
 * Parse amount from various formats:
 * - "50¢" -> 0.50
 * - "$0.5" or "$0.50" -> 0.50
 * - "0.5" -> 0.50
 */
function parseAmount(amountStr: string): number {
  const trimmed = amountStr.trim();

  // Handle cents notation (50¢)
  if (trimmed.endsWith("¢")) {
    const cents = parseFloat(trimmed.slice(0, -1));
    if (isNaN(cents)) {
      throw new Error(`Invalid cents amount: ${amountStr}`);
    }
    return cents / 100;
  }

  // Handle dollar notation ($0.5 or $0.50)
  if (trimmed.startsWith("$")) {
    const dollarPart = trimmed.slice(1);

    // Check if it looks like a shell positional parameter ($1, $2, $10, etc.)
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

  // Handle plain decimal (0.5)
  const amount = parseFloat(trimmed);
  if (isNaN(amount)) {
    throw new Error(`Invalid amount: ${amountStr}`);
  }
  return amount;
}

/**
 * Validate molty username
 */
function validateMoltyUsername(username: string): void {
  if (!/^[a-zA-Z0-9_-]{1,30}$/.test(username)) {
    throw new Error(
      `Invalid molty username: ${username}. Must be 1-30 alphanumeric characters, underscores, or hyphens.`,
    );
  }
}

const args = minimist(process.argv.slice(2));

let moltyUsername: string;
let amount: number;

if (args._.length < 2) {
  console.error("Usage: moltycash send <molty_name> <amount> [--network <base|solana>]");
  console.error("\nExamples:");
  console.error("  moltycash send mesut 1¢");
  console.error("  moltycash send alice 50¢");
  console.error("  moltycash send bob 100¢ --network solana");
  console.error("  moltycash send charlie 0.5 --network base");
  console.error("\nAmount formats: 100¢ (cents - recommended), 0.5 (decimal)");
  process.exit(1);
}

try {
  moltyUsername = args._[0];
  validateMoltyUsername(moltyUsername);
  amount = parseAmount(String(args._[1]));
  if (amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }
} catch (error: any) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

// Check which private keys are available
const hasEvmKey = !!privateKey;
const hasSvmKey = !!svmPrivateKey;

// Determine network based on provided arg or auto-detect
let useSolana: boolean;
const allowedNetworks = ["base", "solana"];

if (args.network) {
  if (!allowedNetworks.includes(args.network.toLowerCase())) {
    console.error(`Network must be either 'base' or 'solana'`);
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
  // Auto-detect from available keys
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

async function main(): Promise<void> {
  // Create x402 HTTP client
  const baseClient = new x402Client();
  const client = new x402HTTPClient(baseClient);

  if (useSolana) {
    console.log("\n🔧 Creating Solana signer...");

    const privateKeyBytes = bs58.decode(svmPrivateKey);
    const solanaSigner = await createKeyPairSignerFromBytes(privateKeyBytes);
    console.log(`✅ Solana signer created: ${solanaSigner.address}`);

    registerExactSvmScheme(baseClient, { signer: solanaSigner });
  } else {
    console.log("\n🔧 Creating Base signer...");

    if (!privateKey.startsWith("0x")) {
      console.error("❌ EVM_PRIVATE_KEY must start with '0x'");
      process.exit(1);
    }

    const account = privateKeyToAccount(privateKey);
    console.log(`✅ Base signer created: ${account.address}`);

    registerExactEvmScheme(baseClient, { signer: account });
  }

  console.log(`\n💸 Sending ${amount} USDC to @${moltyUsername}...`);
  console.log(`   API: ${baseURL}/a2a`);
  console.log(`   Network: ${useSolana ? "Solana" : "Base"}`);
  if (identityToken) {
    console.log(`   🔐 Sending as verified sender`);
  }
  console.log();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(identityToken && { "X-Molty-Identity-Token": identityToken }),
  };

  const jsonRpcBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "molty.send",
    params: {
      molty: moltyUsername,
      amount,
      description: `Payment via moltycash-cli (${useSolana ? "Solana" : "Base"})`,
      meta: { agent_name: "moltycash-cli" },
    },
  };

  try {
    // Step 1: Send request, expect 402 with payment requirements
    console.log("💳 Requesting payment requirements...");

    let paymentRequired;
    try {
      const response = await axios.post(`${baseURL}/a2a`, jsonRpcBody, {
        headers,
        validateStatus: (status) => status === 402 || status === 200,
      });

      if (response.status === 200) {
        // Already paid or no payment needed
        console.log(`✅ ${response.data?.result?.status?.message?.parts?.[0]?.text || "Request completed"}`);
        return;
      }

      // Extract payment requirements from 402 response
      paymentRequired = client.getPaymentRequiredResponse(
        (name: string) => response.headers[name.toLowerCase()] as string | undefined,
        response.data,
      );
    } catch (error: any) {
      if (error.response?.status === 402) {
        paymentRequired = client.getPaymentRequiredResponse(
          (name: string) => error.response.headers[name.toLowerCase()] as string | undefined,
          error.response.data,
        );
      } else {
        throw error;
      }
    }

    // Step 2: Sign payment
    console.log("🔐 Signing payment...");
    const signedPayment = await client.createPaymentPayload(paymentRequired);
    const paymentHeaders = client.encodePaymentSignatureHeader(signedPayment);

    // Step 3: Retry with payment header
    console.log("📤 Submitting payment...\n");
    const paidResponse = await axios.post(`${baseURL}/a2a`, jsonRpcBody, {
      headers: { ...headers, ...paymentHeaders },
    });

    if (paidResponse.data.error) {
      throw new Error(paidResponse.data.error.message || "Payment failed");
    }

    const result = paidResponse.data.result;

    // Extract details from task artifacts
    const artifacts = result.artifacts || [];
    for (const artifact of artifacts) {
      if (artifact.data) {
        try {
          const data = JSON.parse(Buffer.from(artifact.data, "base64").toString());
          console.log(`✅ ${data.amount} USDC sent to @${data.molty || moltyUsername}`);
          if (data.transaction_hash) {
            console.log(`🔗 TXN: ${data.transaction_hash}`);
          }
          if (data.network) {
            console.log(`💳 Network: ${data.network}`);
          }
          if (data.receipt) {
            console.log(`📄 Receipt: ${data.receipt}`);
          }
          return;
        } catch {
          // ignore parse errors
        }
      }
    }

    // Fallback: print status message
    const msg = result.status?.message?.parts
      ?.filter((p: any) => p.kind === "text")
      .map((p: any) => p.text)
      .join("\n");
    console.log(`✅ ${msg || "Payment sent"}`);
  } catch (error: any) {
    const errMsg = error.response?.data?.error?.message || error.response?.data?.msg || error.message;
    console.error(`❌ ${errMsg || "Payment failed"}`);

    if (error.response) {
      console.error("   Status:", error.response.status);
    } else if (error.message && !errMsg) {
      console.error("   Error:", error.message);
    }
    process.exit(1);
  }
}

main();
