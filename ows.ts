/**
 * OWS CLI wrapper — shells out to the `ows` binary for wallet and payment operations.
 */

import { execSync } from "child_process";

function findOws(): string {
  const paths = [
    process.env.HOME + "/.ows/bin/ows",
    "/usr/local/bin/ows",
    "ows",
  ];
  for (const p of paths) {
    try {
      execSync(`${p} --version`, { stdio: "ignore" });
      return p;
    } catch {
      // try next
    }
  }
  console.error("OWS CLI not found. Install it:");
  console.error("  curl -fsSL https://docs.openwallet.sh/install.sh | bash");
  process.exit(1);
}

let owsPath: string | undefined;

function getOws(): string {
  if (!owsPath) owsPath = findOws();
  return owsPath;
}

export function owsExec(args: string[]): string {
  const cmd = getOws();
  const escaped = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  try {
    return execSync(`${cmd} ${escaped}`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error: any) {
    const stderr = error.stderr?.toString().trim() || "";
    const stdout = error.stdout?.toString().trim() || "";
    throw new Error(stderr || stdout || "OWS command failed");
  }
}

export function owsPayRequest(url: string, body: object, wallet: string): string {
  const cmd = getOws();
  const bodyJson = JSON.stringify(body);
  try {
    return execSync(
      `${cmd} pay request '${url}' --wallet '${wallet}' --method POST --body '${bodyJson.replace(/'/g, "'\\''")}'`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
  } catch (error: any) {
    const stderr = error.stderr?.toString().trim() || "";
    const stdout = error.stdout?.toString().trim() || "";
    // OWS prints the response body to stdout even on non-2xx
    const output = stdout || stderr;
    // Try to extract JSON-RPC error
    try {
      const parsed = JSON.parse(output);
      if (parsed.error?.message) throw new Error(parsed.error.message);
    } catch (parseErr: any) {
      if (parseErr.message !== output && parseErr.message) throw parseErr;
    }
    throw new Error(output || "OWS payment failed");
  }
}

export function ensureOws(): void {
  getOws();
}
