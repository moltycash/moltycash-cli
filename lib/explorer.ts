/**
 * Build a block-explorer URL for a given chain + tx hash. Shared by human.ts,
 * gig.ts, reward.ts.
 */
export function buildExplorerUrl(txHash?: string, network?: string): string | undefined {
    if (!txHash) return undefined;
    if (network === 'solana') return `https://solscan.io/tx/${txHash}`;
    if (network === 'tempo') return `https://explore.tempo.xyz/receipt/${txHash}`;
    if (network === 'stellar') return `https://stellar.expert/explorer/public/tx/${txHash}`;
    if (network === 'monad') return `https://monadscan.com/tx/${txHash}`;
    if (network === 'worldchain') return `https://worldscan.org/tx/${txHash}`;
    if (network === 'skale') return `https://skale-base-explorer.skalenodes.com/tx/${txHash}`;
    if (network === 'stripe') return `https://dashboard.stripe.com/payments/${txHash}`;
    if (network === 'base' || txHash.startsWith('0x')) return `https://basescan.org/tx/${txHash}`;
    return undefined;
}
