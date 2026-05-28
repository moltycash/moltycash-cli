/**
 * Wallet session token cache + helpers for the moltycash CLI.
 *
 * The session token is a 24h credential proving wallet ownership. Used by
 * payer-side A2A methods that previously required MOLTY_IDENTITY_TOKEN:
 *   gig get / created / review, reward balance / claim
 *
 * Cache file: ~/.config/moltycash/session.json (keyed by wallet address so
 * different wallets keep distinct tokens).
 *
 * Issuance: this CLI calls session.create on the molty.cash A2A endpoint,
 * which costs 1¢ x402. Or any tip/hire/gig.create paid by the same wallet
 * will return a session token piggy-backed onto its response — captured by
 * the human.ts / gig.ts handlers and persisted via writeCachedSession.
 */
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const CACHE_DIR = join(homedir(), '.config', 'moltycash');
const CACHE_FILE = join(CACHE_DIR, 'session.json');

export interface SessionEntry {
    session_token: string;
    session_wallet: string;       // lowercased
    session_expires_at: number;   // unix seconds
}

type Cache = Record<string, SessionEntry>;

function readCache(): Cache {
    try {
        if (!existsSync(CACHE_FILE)) return {};
        const raw = readFileSync(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed ? parsed : {};
    } catch {
        return {};
    }
}

function writeCache(cache: Cache): void {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export function readCachedSession(walletAddress: string): SessionEntry | null {
    const key = walletAddress.toLowerCase();
    const cache = readCache();
    const entry = cache[key];
    if (!entry) return null;
    // Treat as expired if within 60s of exp — give the caller margin to use it.
    const nowSec = Math.floor(Date.now() / 1000);
    if (entry.session_expires_at - 60 <= nowSec) return null;
    return entry;
}

export function writeCachedSession(entry: SessionEntry): void {
    const cache = readCache();
    cache[entry.session_wallet.toLowerCase()] = entry;
    writeCache(cache);
}

export function clearCachedSession(walletAddress: string): void {
    const cache = readCache();
    delete cache[walletAddress.toLowerCase()];
    writeCache(cache);
}

/**
 * Returns the most recently-issued non-expired session in the cache. Useful
 * for `reward balance` after a `tip` issued a session token — the CLI doesn't
 * need to know which wallet's session to use; it just grabs the latest.
 */
export function readLatestSession(): SessionEntry | null {
    const cache = readCache();
    const nowSec = Math.floor(Date.now() / 1000);
    const active = Object.values(cache).filter(s => s.session_expires_at - 60 > nowSec);
    if (active.length === 0) return null;
    active.sort((a, b) => b.session_expires_at - a.session_expires_at);
    return active[0];
}

/**
 * Try to capture a session token from a generic JSON-RPC result. Tips / hires
 * / gig.create may return either a flat object with `session_token` fields or
 * an A2A task whose artifact.data is a base64-encoded JSON with those fields.
 */
export function captureSessionFromResult(result: unknown): void {
    if (!result || typeof result !== 'object') return;
    const r = result as any;

    // Flat shape (HTTP x402 / MPP tip return)
    if (r.session_token && r.session_wallet && r.session_expires_at) {
        writeCachedSession({
            session_token: String(r.session_token),
            session_wallet: String(r.session_wallet),
            session_expires_at: Number(r.session_expires_at),
        });
        return;
    }

    // A2A task shape — look inside artifacts
    const artifacts: any[] = Array.isArray(r.artifacts) ? r.artifacts : [];
    for (const a of artifacts) {
        if (!a?.data) continue;
        try {
            const parsed = JSON.parse(Buffer.from(a.data, 'base64').toString());
            if (parsed.session_token && parsed.session_wallet && parsed.session_expires_at) {
                writeCachedSession({
                    session_token: String(parsed.session_token),
                    session_wallet: String(parsed.session_wallet),
                    session_expires_at: Number(parsed.session_expires_at),
                });
                return;
            }
        } catch { /* ignore */ }
    }
}
