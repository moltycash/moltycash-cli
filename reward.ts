import "dotenv/config";
import minimist from "minimist";
import axios from "axios";
import { readCachedSession, readLatestSession } from "./lib/session.js";
import { buildExplorerUrl } from "./lib/explorer.js";
import { buildX402Signer } from "./lib/x402Network.js";

const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.molty.cash";
const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

let rpcIdCounter = 1;

async function rpcWithSession(method: string, params: Record<string, unknown>, sessionToken: string): Promise<any> {
    const response = await axios.post(`${baseURL}/a2a`, {
        jsonrpc: "2.0",
        id: rpcIdCounter++,
        method,
        params,
    }, {
        headers: {
            "Content-Type": "application/json",
            "X-Molty-Session-Token": sessionToken,
        },
    });
    if (response.data.error) {
        const err = response.data.error;
        const e: any = new Error(err.message || "A2A request failed");
        e.code = err.code;
        e.data = err.data;
        throw e;
    }
    return response.data.result;
}

async function rpcA2A(method: string, params: Record<string, unknown>): Promise<any> {
    const response = await axios.post(`${baseURL}/a2a`, {
        jsonrpc: "2.0",
        id: rpcIdCounter++,
        method,
        params,
    }, {
        headers: {
            "Content-Type": "application/json",
            "X-A2A-Extensions": X402_EXTENSION_URI,
        },
    });
    if (response.data.error) {
        const err = response.data.error;
        const e: any = new Error(err.message || "A2A request failed");
        e.code = err.code;
        e.data = err.data;
        throw e;
    }
    return response.data.result;
}

async function resolveWalletLabel(): Promise<string> {
    // Reuse the x402 signer setup so we accept the same chain set everywhere.
    const { walletLabel } = await buildX402Signer();
    return walletLabel;
}

async function handleBalance(): Promise<void> {
    // Prefer the wallet-specific session if any env key is set; otherwise just
    // grab the latest cached session (e.g. one issued by a recent hire).
    let cached = null;
    try {
        const label = await resolveWalletLabel();
        cached = readCachedSession(label);
    } catch { /* no env vars set — fall through to latest */ }
    if (!cached) cached = readLatestSession();
    if (!cached) {
        console.error("❌ No active session found.");
        console.error("   Make a paid call to mint one — any of:");
        console.error("     npx moltycash session create");
        process.exit(1);
    }
    console.log(`🔍 Reading reward balance for ${cached.session_wallet}...`);
    const result = await rpcWithSession("reward.balance", {}, cached.session_token);
    console.log("");
    console.log(`Molty wallet:        ${result.molty_wallet || '(no wallet yet)'}`);
    console.log(`$moltycash balance:  ${(result.balance_tokens || 0).toLocaleString()}`);
    if (result.balance_usd > 0) {
        const u = result.balance_usd;
        console.log(`USD value (≈):       ${u >= 0.01 ? `$${u.toFixed(2)}` : '< $0.01'}`);
    }
    console.log(`Current tier:        ${result.current_tier_label || 'Starter'} (${result.current_percentage ?? 0}% rebate)`);
    if (result.next_tier_min_tokens) {
        console.log(`Next tier at:        ${result.next_tier_min_tokens.toLocaleString()} tokens (${result.next_tier_percentage}% rebate)`);
    }
    if (result.tier_jumps) {
        for (const [label, jump] of Object.entries(result.tier_jumps as Record<string, any>)) {
            console.log(`To reach ${label.padEnd(7)}: ${jump.required_moltycash_tokens.toLocaleString()} tokens — pay ~$${jump.usdc_needed.toFixed(2)} USDC → ${jump.reward_percentage}% rebate`);
        }
    }
    if (result.spot_price_usd) console.log(`Spot price:          $${result.spot_price_usd.toExponential(4)} per token`);
    const exitPct = ((result.exit_tax_percent ?? 0.01) * 100).toFixed(1);
    console.log(`Exit tax on claim:   ${exitPct}% of claim value (min $${(result.exit_tax_min_usd ?? 0.02).toFixed(2)} USDC)`);
    console.log(`Claimable now:       ${result.claimable ? 'YES' : 'no — empty balance'}`);
    if (result.rewards_paused) console.log(`⚠️  Rewards are currently paused.`);
}

async function handleClaim(args: minimist.ParsedArgs): Promise<void> {
    const destination = args.destination || args.to;
    if (!destination || typeof destination !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(destination)) {
        console.error("❌ --destination <0x...> is required (Base EVM address that receives the $moltycash)");
        process.exit(1);
    }

    // Build x402 client for whichever chain has a private key configured. The
    // signing chain doesn't have to match the destination — destination is
    // always Base EVM (where the sweep lands); fee can be paid from any
    // supported x402 chain (Base or Solana).
    const { client, walletLabel, network } = await buildX402Signer();
    console.log(`🎁 Claiming $moltycash for ${walletLabel} (${network}) → ${destination}`);

    // Phase 1: request fee challenge
    console.log("💳 Phase 1: requesting USDC exit-tax challenge...");
    const phase1 = await rpcA2A("reward.claim", { destination });
    if (!phase1.id) throw new Error("Missing task ID in Phase 1 response");
    const paymentRequired = phase1.status?.message?.metadata?.["x402.payment.required"];
    if (!paymentRequired) throw new Error("No payment requirements in Phase 1 response");

    // Show the fee from the requirements
    const baseReq = (paymentRequired.accepts || []).find((r: any) => r.network?.startsWith('eip155:8453') || r.network?.startsWith('eip155:84532'));
    if (baseReq) {
        const feeUsd = Number(baseReq.amount) / 1e6;
        console.log(`   Exit tax:         $${feeUsd.toFixed(2)} USDC`);
    }

    // Phase 2: sign + submit
    console.log("🔐 Phase 2: signing USDC fee + executing claim...");
    const signedPayment = await client.createPaymentPayload(paymentRequired);
    const phase2 = await rpcA2A("reward.claim", {
        destination,
        taskId: phase1.id,
        payment: signedPayment,
    });

    // Extract the artifact
    const artifacts = phase2.artifacts || [];
    let receipt: any = null;
    for (const a of artifacts) {
        if (a.data) {
            try {
                const parsed = JSON.parse(Buffer.from(a.data, "base64").toString());
                if (parsed.sweep_tx) {
                    receipt = parsed;
                    break;
                }
            } catch { /* ignore */ }
        }
    }
    if (!receipt) {
        // Task may have failed — surface the status message
        const msg = phase2.status?.message?.parts
            ?.filter((p: any) => p.kind === "text")
            .map((p: any) => p.text)
            .join("\n");
        throw new Error(msg || "claim completed but no receipt artifact found");
    }

    console.log("");
    console.log(`✅ Claimed ${receipt.claimed_tokens.toLocaleString()} $moltycash`);
    console.log(`   Destination:    ${receipt.destination}`);
    console.log(`   Fee paid:       $${receipt.fee_paid_usd} USDC (${receipt.fee_network || 'base'})`);
    const feeExplorer = buildExplorerUrl(receipt.fee_tx, receipt.fee_network) || receipt.fee_tx;
    console.log(`   Fee tx:         ${feeExplorer}`);
    const sweepExplorer = buildExplorerUrl(receipt.sweep_tx, receipt.sweep_network || 'base') || receipt.sweep_tx;
    console.log(`   Sweep tx:       ${sweepExplorer}`);
}

const args = minimist(process.argv.slice(2), {
    string: ['destination', 'to'],
});
const subcommand = args._[0];

async function main(): Promise<void> {
    try {
        switch (subcommand) {
            case "balance":
                await handleBalance();
                break;
            case "claim":
                await handleClaim(args);
                break;
            default:
                console.error("Usage:");
                console.error("  moltycash reward balance");
                console.error("  moltycash reward claim --destination <0x...>");
                console.error("");
                console.error("balance requires an active session (run `moltycash session create` first).");
                console.error("claim requires EVM_PRIVATE_KEY only — it pays a $1 USDC exit tax via x402.");
                process.exit(1);
        }
    } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error(`❌ ${msg || "Reward command failed"}`);
        if (err.data) console.error(`   data: ${JSON.stringify(err.data)}`);
        process.exit(1);
    }
}

main();
