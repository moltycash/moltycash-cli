import "dotenv/config";
import minimist from "minimist";
import axios from "axios";
import { writeCachedSession, readCachedSession } from "./lib/session.js";
import { buildX402Signer } from "./lib/x402Network.js";
import { hasMppKey, buildMppFetch } from "./lib/mppNetwork.js";

const baseURL = process.env.RESOURCE_SERVER_URL || "https://api.molty.cash";
const X402_EXTENSION_URI = "https://github.com/google-a2a/a2a-x402/v0.1";

let rpcIdCounter = 1;

async function a2aCall(method: string, params: Record<string, unknown>): Promise<any> {
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
    if (response.data.error) throw new Error(response.data.error.message || "A2A request failed");
    return response.data.result;
}

async function handleSessionCreate(): Promise<void> {
    // MPP chains (Tempo / Stellar / Monad) take a different transport — single
    // POST with Authorization: Payment header, mppFetch auto-handles 402 cycle.
    if (hasMppKey()) {
        const { mppFetch, walletLabel, network } = await buildMppFetch();
        console.log(`🔧 Wallet: ${walletLabel} (${network})`);
        console.log(`💳 Signing USDC auth payment via MPP (${network})...`);
        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "session.create", params: {} });
        const resp = await mppFetch(`${baseURL}/a2a`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
        });
        const data = await resp.json() as any;
        if (data.error) throw new Error(data.error.message || "MPP session.create failed");
        const issued = data.result;
        if (!issued?.session_token) throw new Error("session_token missing from MPP response");
        writeCachedSession(issued);
        const expiresIn = Math.max(0, issued.session_expires_at - Math.floor(Date.now() / 1000));
        console.log(`✅ Session token cached for wallet ${issued.session_wallet}`);
        console.log(`   Expires in ${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m`);
        return;
    }

    const { client, walletLabel, network } = await buildX402Signer();
    console.log(`🔧 Wallet: ${walletLabel} (${network})`);

    console.log("💳 Phase 1: requesting USDC auth payment challenge...");
    const phase1 = await a2aCall("session.create", {});
    if (!phase1.id) throw new Error("Missing task ID in Phase 1 response");
    const paymentRequired = phase1.status?.message?.metadata?.["x402.payment.required"];
    if (!paymentRequired) throw new Error("No payment requirements found");

    console.log("🔐 Phase 2: signing payment + submitting...");
    const signedPayment = await client.createPaymentPayload(paymentRequired);
    const phase2 = await a2aCall("session.create", {
        taskId: phase1.id,
        payment: signedPayment,
    });

    const artifacts = phase2.artifacts || [];
    let issued: { session_token: string; session_wallet: string; session_expires_at: number } | null = null;
    for (const a of artifacts) {
        if (a.data) {
            try {
                const parsed = JSON.parse(Buffer.from(a.data, "base64").toString());
                if (parsed.session_token) {
                    issued = parsed;
                    break;
                }
            } catch { /* ignore */ }
        }
    }
    if (!issued) throw new Error("session_token not found in Phase 2 artifacts");

    writeCachedSession(issued);
    const expiresIn = Math.max(0, issued.session_expires_at - Math.floor(Date.now() / 1000));
    console.log(`✅ Session token cached for wallet ${issued.session_wallet}`);
    console.log(`   Expires in ${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m`);
}

async function handleSessionStatus(): Promise<void> {
    const { walletLabel } = await buildX402Signer();
    const cached = readCachedSession(walletLabel);
    if (!cached) {
        console.log(`No active session for ${walletLabel}. Run: moltycash session create`);
        return;
    }
    const expiresIn = Math.max(0, cached.session_expires_at - Math.floor(Date.now() / 1000));
    console.log(`Wallet:    ${cached.session_wallet}`);
    console.log(`Expires:   ${Math.floor(expiresIn / 3600)}h ${Math.floor((expiresIn % 3600) / 60)}m from now`);
}

const args = minimist(process.argv.slice(2));
const subcommand = args._[0];

async function main(): Promise<void> {
    try {
        switch (subcommand) {
            case "create":
                await handleSessionCreate();
                break;
            case "status":
                await handleSessionStatus();
                break;
            default:
                console.error("Usage: moltycash session <create|status>");
                process.exit(1);
        }
    } catch (err: any) {
        const msg = err.response?.data?.error?.message || err.message;
        console.error(`❌ ${msg || "Session command failed"}`);
        process.exit(1);
    }
}

main();
