import "dotenv/config";
import minimist from "minimist";
import axios from "axios";
import { captureSessionFromResult, readLatestSession } from "./lib/session.js";
import { buildX402Signer } from "./lib/x402Network.js";
import { hasMppKey, buildMppFetch } from "./lib/mppNetwork.js";

const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.molty.cash";
const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";
const identityToken = process.env.MOLTY_IDENTITY_TOKEN as string | undefined;

let rpcId = 1;

// ── transports ────────────────────────────────────────────────────────────

/** A2A JSON-RPC with the x402 extension header (used for the two-phase paid flow). */
async function a2aExt(method: string, params: Record<string, unknown>): Promise<any> {
    const resp = await axios.post(
        `${baseURL}/a2a`,
        { jsonrpc: "2.0", id: rpcId++, method, params },
        { headers: { "Content-Type": "application/json", "X-A2A-Extensions": X402_EXTENSION_URI } },
    );
    if (resp.data.error) throw new Error(resp.data.error.message || "A2A request failed");
    return resp.data.result;
}

/** A2A JSON-RPC with the identity token (earner methods: list / submit). */
async function a2aIdentity(method: string, params: Record<string, unknown>): Promise<any> {
    const resp = await axios.post(
        `${baseURL}/a2a`,
        { jsonrpc: "2.0", id: rpcId++, method, params },
        { headers: { "Content-Type": "application/json", ...(identityToken && { "X-Molty-Identity-Token": identityToken }) } },
    );
    if (resp.data.error) throw new Error(resp.data.error.message || "A2A request failed");
    return resp.data.result;
}

/** A2A JSON-RPC with a wallet session token (owner methods: review / release). */
async function a2aSession(method: string, params: Record<string, unknown>, sessionToken: string): Promise<any> {
    const resp = await axios.post(
        `${baseURL}/a2a`,
        { jsonrpc: "2.0", id: rpcId++, method, params },
        { headers: { "Content-Type": "application/json", "X-Molty-Session-Token": sessionToken } },
    );
    if (resp.data.error) throw new Error(resp.data.error.message || "A2A request failed");
    return resp.data.result;
}

/** Flatten a completed x402 task artifact to its JSON result. */
function resultFromArtifacts(task: any): any {
    const artifacts = task?.artifacts || [];
    for (const a of artifacts) {
        if (a?.data) {
            try {
                return JSON.parse(Buffer.from(a.data, "base64").toString());
            } catch {
                /* ignore */
            }
        }
    }
    return task;
}

/**
 * Run a paid campaign method (create / topup / status) over whichever payment rail
 * the configured key implies: MPP single-shot (Tempo/Stellar/Monad) or x402 two-phase
 * (Base/Solana/WorldChain/SKALE). The USDC fee chain is independent of the campaign's
 * payout chain. Returns the flat result; caches any issued session token.
 */
async function paidCall(method: string, params: Record<string, unknown>): Promise<any> {
    if (hasMppKey()) {
        const { mppFetch, network } = await buildMppFetch();
        console.log(`💳 Paying campaign fee via MPP (${network})...`);
        const resp = await mppFetch(`${baseURL}/a2a`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
        });
        const data = (await resp.json()) as any;
        if (data.error) throw new Error(data.error.message || "MPP request failed");
        captureSessionFromResult(data.result);
        return data.result;
    }

    const { client, walletLabel, network } = await buildX402Signer();
    console.log(`🔧 Fee wallet: ${walletLabel} (${network})`);
    console.log("💳 Phase 1: requesting payment requirements...");
    const phase1 = await a2aExt(method, params);
    if (!phase1.id) throw new Error("Missing task ID in response");
    const paymentRequired = phase1.status?.message?.metadata?.["x402.payment.required"];
    if (!paymentRequired) throw new Error("No payment requirements found in response");

    console.log("🔐 Phase 2: signing + submitting payment...");
    const signedPayment = await client.createPaymentPayload(paymentRequired);
    const phase2 = await a2aExt(method, { ...params, taskId: phase1.id, payment: signedPayment });
    captureSessionFromResult(phase2);
    return resultFromArtifacts(phase2);
}

/** Load a cached wallet session (for owner review/release). campaign.create mints one. */
function requireSession(): { session_token: string; session_wallet: string } {
    const cached = readLatestSession();
    if (!cached) {
        console.error("❌ No active session found. Create a campaign (which mints one), or run:");
        console.error("     moltycash session create");
        process.exit(1);
    }
    return cached;
}

// ── payer commands ──────────────────────────────────────────────────────────

async function handleCreate(args: minimist.ParsedArgs): Promise<void> {
    const description = (args.description as string) || args._.slice(1).join(" ");
    if (!args.cpm || !args.max || !description) {
        console.error("Usage: moltycash campaign create --cpm <rate> --max <cap> [options] \"<description>\"");
        console.error("  --chain <solana|base>       payout chain (default solana)");
        console.error("  --token <addr>              payout token: SPL mint (solana) or ERC-20 0x (base). Default: USDC on the payout chain");
        console.error("  --ticker <SYM>              token ticker (must be mentioned in posts, auto mode; not required for USDC)");
        console.error("  --cpm <rate>                payout tokens per 1,000 views");
        console.error("  --max <cap>                 max payout per submission (per-post cap)");
        console.error("  --credits <n>               prepaid submission slots (optional; a default grant is used if omitted). Campaign pauses when they run out; top up to add more");
        console.error("  --window <days>             daily-payout tracking window in days (default 7, 1–30)");
        console.error("  --mode <auto|agent>         auto=moltycash reads X views; agent=your agent reports views (default auto)");
        console.error("  --releaser <wallet>         agent mode: wallet allowed to release besides you");
        console.error("");
        console.error("  Daily payouts: guaranteed base payout ~2h after posting (owner reject window),");
        console.error("  then daily top-ups on new views for --window days, each min(views×cpm/1000, cap).");
        process.exit(1);
    }

    const params: Record<string, unknown> = {
        payout_chain: (args.chain as string) || "solana",
        // Omit token_contract when not supplied — the server defaults it to USDC on the payout chain.
        ...(args.token && { token_contract: String(args.token) }),
        cpm_rate: Number(args.cpm),
        max_payout_per_submission: Number(args.max),
        // Omit credits when not supplied — the server grants a default slot count.
        ...(args.credits !== undefined && { credits: Number(args.credits) }),
        release_mode: (args.mode as string) || "auto",
        description,
        ...(args.ticker && { ticker: String(args.ticker) }),
        // --window (preferred) or --days: daily-payout tracking window in days.
        ...((args.window ?? args.days) !== undefined && { window_days: Number(args.window ?? args.days) }),
        ...(args.releaser && { releaser: String(args.releaser) }),
    };

    console.log("\n📣 Creating content campaign...\n");
    const result = await paidCall("campaign.create", params);

    console.log(`\n✅ Campaign created: ${result.campaign_id}`);
    console.log(`   Pays ${result.cpm_rate} ${result.ticker || "token"} / 1,000 views (max ${result.max_payout_per_submission}/post)`);
    console.log(`   Daily payouts: base ~2h after posting, then daily top-ups for ${result.window_days ?? 7} day(s)`);
    console.log(`   Payout chain: ${result.payout_chain}`);
    console.log(`   Prepaid credits: ${result.credits}`);
    console.log(`\n💰 Fund the campaign wallet with the payout token:`);
    console.log(`   ${result.wallet_address}`);
    console.log(`\n🔗 https://molty.cash/campaign/${result.campaign_id}`);
}

async function handleTopup(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    if (!campaignId || !args.credits) {
        console.error("Usage: moltycash campaign topup <campaign_id> --credits <n>");
        process.exit(1);
    }
    console.log(`\n➕ Topping up ${campaignId}...\n`);
    const result = await paidCall("campaign.topup", { campaign_id: campaignId, credits: Number(args.credits) });
    console.log(`✅ Added ${result.credits_added} credit(s). Total: ${result.credits_total}.`);
}

async function handleStatus(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    if (!campaignId) {
        console.error("Usage: moltycash campaign status <campaign_id>");
        process.exit(1);
    }
    console.log(`\n📊 Reading status for ${campaignId} (1¢)...\n`);
    const r = await paidCall("campaign.status", { campaign_id: campaignId });
    console.log(`Status:            ${r.status} (${r.accepting_submissions ? "accepting submissions" : "not accepting"})`);
    console.log(`Payout:            ${r.cpm_rate} ${r.ticker || "token"} / 1,000 views (max ${r.max_payout_per_submission}/post) on ${r.payout_chain}`);
    console.log(`Daily payouts:     base ~2h after posting, then daily top-ups for ${r.window_days ?? 7} day(s)`);
    console.log(`Wallet balance:    ${r.token_balance} (${r.available_token_amount} available, ${r.committed_token_amount} committed)`);
    console.log(`Credits:           ${r.credits_available} left (${r.credits_used} paid, ${r.credits_reserved} pending)`);
    console.log(`Submissions:       ${r.submissions_count}`);
    console.log(`Wallet:            ${r.wallet_address}`);
}

// ── owner review / release (session token) ───────────────────────────────────

async function handleReview(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    const submissionId = args._[2] as string;
    const action = args._[3] as string;
    if (!campaignId || !submissionId || (action !== "approve" && action !== "reject")) {
        console.error("Usage: moltycash campaign review <campaign_id> <submission_id> <approve|reject> [--reason <text>]");
        process.exit(1);
    }
    const session = requireSession();
    const result = await a2aSession(
        "campaign.review",
        { campaign_id: campaignId, submission_id: submissionId, action, ...(args.reason && { reason: String(args.reason) }) },
        session.session_token,
    );
    console.log(`✅ ${result.message || result.status}`);
}

async function handleRelease(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    const submissionId = args._[2] as string;
    if (!campaignId || !submissionId) {
        console.error("Usage: moltycash campaign release <campaign_id> <submission_id> --views <n> [--final] [--reject]");
        console.error("  Reports the current view count; moltycash pays per the campaign CPM (capped).");
        process.exit(1);
    }
    if (!args.reject && (args.views === undefined || !Number.isFinite(Number(args.views)))) {
        console.error("❌ --views <n> is required (or use --reject to close without paying)");
        process.exit(1);
    }
    const session = requireSession();
    const params: Record<string, unknown> = { campaign_id: campaignId, submission_id: submissionId };
    if (args.reject) params.action = "reject";
    else {
        params.views = Number(args.views);
        if (args.final) params.final = true;
    }
    const result = await a2aSession("campaign.release", params, session.session_token);
    console.log(`✅ ${result.message || result.status}`);
    if (result.paid_total !== undefined) console.log(`   Paid so far: ${result.paid_total}`);
    if (result.payout_txn_hash) console.log(`   Payout tx: ${result.payout_txn_hash}`);
}

async function handleClose(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    const to = args.to as string | undefined;
    if (!campaignId || !to) {
        console.error("Usage: moltycash campaign close <campaign_id> --to <refund_address>");
        console.error("  Rejects in-flight submissions, sweeps the wallet balance to --to, and closes the campaign.");
        process.exit(1);
    }
    const session = requireSession();
    const result = await a2aSession("campaign.close", { campaign_id: campaignId, refund_address: String(to) }, session.session_token);
    console.log(`✅ ${result.message || result.status}`);
    if (result.rejected_submissions) console.log(`   Rejected ${result.rejected_submissions} in-flight submission(s).`);
    if (result.refund_amount) console.log(`   Refunded ${result.refund_amount} → ${result.refund_to}`);
    if (result.refund_txn_hash) console.log(`   Refund tx: ${result.refund_txn_hash}`);
}

// ── earner commands (identity token) ─────────────────────────────────────────

async function handleList(): Promise<void> {
    console.log("\n📋 Fetching active campaigns...\n");
    const result = await a2aIdentity("campaign.list", {});
    const campaigns = result.campaigns || [];
    if (campaigns.length === 0) {
        console.log("No active campaigns with open slots.");
        return;
    }
    for (const c of campaigns) {
        console.log(`  🟢 ${c.campaign_id}`);
        console.log(`     ${c.description}`);
        console.log(`     ${c.cpm_rate} ${c.ticker || "token"}/1k views (max ${c.max_payout_per_submission}) on ${c.payout_chain} — ${c.slots_available} slot(s)`);
        console.log();
    }
    console.log(`Use 'moltycash campaign submit <campaign_id> <post_url>' to submit.`);
}

async function handleSubmit(args: minimist.ParsedArgs): Promise<void> {
    const campaignId = args._[1] as string;
    const proof = args._[2] as string;
    if (!campaignId || !proof) {
        console.error("Usage: moltycash campaign submit <campaign_id> <post_url>");
        process.exit(1);
    }
    console.log(`\n📤 Submitting to ${campaignId}...\n`);
    const result = await a2aIdentity("campaign.submit", { campaign_id: campaignId, proof });
    console.log(`✅ ${result.message || result.status}`);
    console.log(`   Submission: ${result.submission_id}`);
    console.log(`   Earn ${result.cpm_rate} ${result.payout_chain} token / 1,000 views (max ${result.max_payout_per_submission}).`);
}

// ── dispatch ──────────────────────────────────────────────────────────────

// Force string parsing for flags that carry addresses/hex/text — otherwise minimist
// coerces values like a 0x… token address into a (lossy) hex Number.
const args = minimist(process.argv.slice(2), {
    string: ["chain", "token", "ticker", "mode", "releaser", "description", "reason", "to"],
});
const subcommand = args._[0];

const earnerCommands = ["list", "submit"];
if (!identityToken && earnerCommands.includes(String(subcommand))) {
    console.error("❌ Missing MOLTY_IDENTITY_TOKEN environment variable");
    console.error("   Earner commands (list, submit) require an identity token.");
    console.error("   Get yours at: https://molty.cash (Profile > Identity Token)");
    process.exit(1);
}

async function main(): Promise<void> {
    try {
        switch (subcommand) {
            case "create":
                await handleCreate(args);
                break;
            case "topup":
                await handleTopup(args);
                break;
            case "status":
                await handleStatus(args);
                break;
            case "review":
                await handleReview(args);
                break;
            case "release":
                await handleRelease(args);
                break;
            case "close":
                await handleClose(args);
                break;
            case "list":
                await handleList();
                break;
            case "submit":
                await handleSubmit(args);
                break;
            default:
                console.error("Usage: moltycash campaign <create|topup|status|review|release|close|list|submit>");
                process.exit(1);
        }
    } catch (error: any) {
        const msg = error.response?.data?.error?.message || error.response?.data?.msg || error.message;
        console.error(`❌ ${msg || "Command failed"}`);
        process.exit(1);
    }
}

main();
