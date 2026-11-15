/**
 * SHA-256 through Web Crypto, which exists in every target: browsers (including
 * pages opened over `file://` — verified in the spike) and Node 19+ as
 * `globalThis.crypto`. No hashing library is bundled into the launcher.
 */

export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto is not available in this browser");
  // Copy into a fresh ArrayBuffer: `digest` rejects views over a SharedArrayBuffer
  // and some views over pooled Node buffers.
  const digest = await subtle.digest("SHA-256", data.slice().buffer);
  return toHex(new Uint8Array(digest));
}

export function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
