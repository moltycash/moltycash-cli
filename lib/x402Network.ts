/**
 * Build an x402Client signer for whichever chain has a private key configured
 * in env vars. Used by session.create and reward.claim — both are pure x402
 * flows (not MPP) so they support: Base / Solana.
 */
import { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import bs58 from "bs58";

export interface X402SignerSetup {
    client: any;
    walletLabel: string;
    network: 'base' | 'solana';
}

export async function buildX402Signer(): Promise<X402SignerSetup> {
    const evmKey = process.env.EVM_PRIVATE_KEY as Hex | undefined;
    const svmKey = process.env.SVM_PRIVATE_KEY as string | undefined;
    const keyCount = [evmKey, svmKey].filter(Boolean).length;
    if (keyCount === 0) {
        throw new Error(
            "Set one of: EVM_PRIVATE_KEY (Base), SVM_PRIVATE_KEY (Solana)"
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
    // EVM Base default
    if (!evmKey || !evmKey.startsWith("0x")) {
        throw new Error("EVM_PRIVATE_KEY must start with '0x'");
    }
    const account = privateKeyToAccount(evmKey);
    registerExactEvmScheme(client, { signer: account });
    return { client, walletLabel: account.address, network: 'base' };
}
