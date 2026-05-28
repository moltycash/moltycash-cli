/**
 * Detect an MPP chain key (TEMPO_PRIVATE_KEY / STELLAR_SECRET_KEY /
 * MONAD_PRIVATE_KEY) and return an mppFetch function the caller can use to
 * POST a JSON-RPC request that will auto-handle the 402 challenge cycle
 * via the Authorization: Payment header.
 *
 * Stripe deliberately excluded — $0.30 fixed fee makes $0.02 / $1 auth
 * payments uneconomic. If a user has STRIPE_API_KEY set, we'd surface a
 * helpful error rather than silently picking it.
 */
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Mppx } from "@stellar/mpp/charge/client";
import { stellar } from "@stellar/mpp/charge/client";
import { tempo } from "mppx/client";
import { monad } from "@monad-crypto/mpp/client";

export type MppNetwork = 'tempo' | 'stellar' | 'monad';

export interface MppFetchSetup {
    mppFetch: typeof globalThis.fetch;
    walletLabel: string;
    network: MppNetwork;
}

export function hasMppKey(): boolean {
    return !!(
        process.env.TEMPO_PRIVATE_KEY
        || process.env.STELLAR_SECRET_KEY
        || process.env.MONAD_PRIVATE_KEY
    );
}

export async function buildMppFetch(): Promise<MppFetchSetup> {
    const tempoKey = process.env.TEMPO_PRIVATE_KEY as Hex | undefined;
    const stellarKey = process.env.STELLAR_SECRET_KEY as string | undefined;
    const monadKey = process.env.MONAD_PRIVATE_KEY as Hex | undefined;
    const keyCount = [tempoKey, stellarKey, monadKey].filter(Boolean).length;
    if (keyCount === 0) throw new Error("No MPP private key set (TEMPO_PRIVATE_KEY / STELLAR_SECRET_KEY / MONAD_PRIVATE_KEY)");
    if (keyCount > 1) throw new Error("Multiple MPP keys set. Unset the ones you don't want to use — only one chain per call.");

    if (monadKey) {
        if (!monadKey.startsWith("0x")) throw new Error("MONAD_PRIVATE_KEY must start with '0x'");
        const account = privateKeyToAccount(monadKey);
        const mppClient = Mppx.create({
            methods: [monad.charge({ account })],
            polyfill: false,
        });
        return { mppFetch: mppClient.fetch, walletLabel: account.address, network: 'monad' };
    }
    if (tempoKey) {
        if (!tempoKey.startsWith("0x")) throw new Error("TEMPO_PRIVATE_KEY must start with '0x'");
        const account = privateKeyToAccount(tempoKey);
        const mppClient = Mppx.create({
            methods: [tempo.charge({ account })],
            polyfill: false,
        });
        return { mppFetch: mppClient.fetch, walletLabel: account.address, network: 'tempo' };
    }
    // Stellar
    const mppClient = Mppx.create({
        methods: [
            stellar.charge({
                secretKey: stellarKey!,
                onProgress: (event: any) => {
                    if (event.type === 'challenge') console.log(`   💰 ${event.amount} stroops → ${event.recipient}`);
                    if (event.type === 'signing') console.log("   🔐 Signing Soroban transaction...");
                    if (event.type === 'paying') console.log("   📤 Submitting payment...");
                    if (event.type === 'paid') console.log(`   ✅ Paid! Hash: ${event.hash}`);
                },
            }),
        ],
        polyfill: false,
    });
    // We don't have a clean way to derive the Stellar public address from the
    // secret without an SDK import — use a placeholder; the server resolves
    // the actual payer from the settled payment anyway.
    return { mppFetch: mppClient.fetch, walletLabel: 'stellar-signer', network: 'stellar' };
}
