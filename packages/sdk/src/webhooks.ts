/** Verify the signature over the exact raw body BEFORE parsing JSON. Rejects stale/replayed timestamps. */
export async function verifyWebhook(options: { body: string; secret: string; signature: string; timestamp: string; toleranceSeconds?: number; now?: number }): Promise<boolean> {
  const tolerance = options.toleranceSeconds ?? 300;
  if (!Number.isFinite(tolerance) || tolerance < 0 || !/^\d{1,12}$/.test(options.timestamp) || !/^v1=[a-f0-9]{64}$/.test(options.signature) || !options.secret) return false;
  const now = options.now ?? Date.now() / 1_000;
  if (!Number.isFinite(now) || Math.abs(now - Number(options.timestamp)) > tolerance) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(options.secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = new Uint8Array(options.signature.slice(3).match(/.{2}/g)!.map((hex) => Number.parseInt(hex, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${options.timestamp}.${options.body}`));
}
