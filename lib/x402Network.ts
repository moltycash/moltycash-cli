/**
 * Build an x402Client signer for whichever chain has a private key configured
 * in env vars. Used by session.create and reward.claim — both are pure x402
 * flows (not MPP) so they support: Base / Solana / World Chain / SKALE.
 *
 * MPP chains (Tempo / Stellar / Monad / Stripe) require server-side MPP
 * dispatch on each method, which isn't wired into session.create or
 * reward.claim yet. Tip/hire/gig.create already support them via separate
 * code paths.
 */
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

const SKALE_CHAIN_ID = 1187947933;
const SKALE_NETWORK_ID = `eip155:${SKALE_CHAIN_ID}` as const;

export interface X402SignerSetup {
    client: any;
    walletLabel: string;
    network: 'base' | 'solana' | 'worldchain' | 'skale';
}

export async function buildX402Signer(): Promise<X402SignerSetup> {
    const evmKey = process.env.EVM_PRIVATE_KEY as Hex | undefined;
    const svmKey = process.env.SVM_PRIVATE_KEY as string | undefined;
    const worldchainKey = process.env.WORLDCHAIN_PRIVATE_KEY as Hex | undefined;
    const skaleKey = process.env.SKALE_PRIVATE_KEY as Hex | undefined;
    const keyCount = [evmKey, svmKey, worldchainKey, skaleKey].filter(Boolean).length;
    if (keyCount === 0) {
        throw new Error(
            "Set one of: EVM_PRIVATE_KEY (Base), SVM_PRIVATE_KEY (Solana), WORLDCHAIN_PRIVATE_KEY, SKALE_PRIVATE_KEY"
        );
    }
    if (keyCount > 1) {
        throw new Error(
            "Multiple chain keys set. Unset the ones you don't want to use — only one chain per call."
        );
    }

    const client = new x402Client();

    if (svmKey) {
        const keyBytes = bs58.decode(svmKey);
        const signer = await createKeyPairSignerFromBytes(keyBytes);
        registerExactSvmScheme(client, { signer });
        return { client, walletLabel: signer.address, network: 'solana' };
    }
    if (worldchainKey) {
        if (!worldchainKey.startsWith("0x")) throw new Error("WORLDCHAIN_PRIVATE_KEY must start with '0x'");
        const account = privateKeyToAccount(worldchainKey);
        registerExactEvmScheme(client, {
            signer: account,
            networks: ["eip155:480"],
            paymentRequirementsSelector: (_ver: number, reqs: any[]) =>
                reqs.find((r: any) => r.network === "eip155:480") || reqs[0],
        });
        return { client, walletLabel: account.address, network: 'worldchain' };
    }
    if (skaleKey) {
        if (!skaleKey.startsWith("0x")) throw new Error("SKALE_PRIVATE_KEY must start with '0x'");
        const account = privateKeyToAccount(skaleKey);
        registerExactEvmScheme(client, {
            signer: account,
            networks: [SKALE_NETWORK_ID],
            paymentRequirementsSelector: (_ver: number, reqs: any[]) =>
                reqs.find((r: any) => r.network === SKALE_NETWORK_ID) || reqs[0],
        });
        return { client, walletLabel: account.address, network: 'skale' };
    }
    // EVM Base default
    if (!evmKey || !evmKey.startsWith("0x")) {
        throw new Error("EVM_PRIVATE_KEY must start with '0x'");
    }
    const account = privateKeyToAccount(evmKey);
    registerExactEvmScheme(client, { signer: account });
    return { client, walletLabel: account.address, network: 'base' };
}
