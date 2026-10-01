import assert from "node:assert/strict";
const base = process.env.CLOUD_EDGE_SMOKE_URL ?? "http://127.0.0.1:9180";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Use a loopback CLOUD_EDGE_SMOKE_URL for this local edge smoke test.");
const home = await fetch(base); assert.equal(home.status, 200); assert.match(await home.text(), /<div id="root"/);
assert.equal((await fetch(`${base}/control/api/auth/options`).then((r) => r.json())).cloud, true);
assert.equal((await fetch(`${base}/v1/health`).then((r) => r.json())).status, "ok");
for (const path of ["/platform/status", "/control/platform/status", "/gateway/platform/status", "/control/%70latform/status", "/gateway/platform%2fstatus", "/%63ontrol/platform/status"]) {
  assert.equal((await fetch(base + path)).status, 404, path);
}
console.log("Production dashboard/API routes work; platform administration is blocked at the edge, including encoded paths.");
