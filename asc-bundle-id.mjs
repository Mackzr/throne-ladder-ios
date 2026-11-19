// Registers an App ID (bundle identifier) in the developer account if it isn't there yet, so the App Store Connect app
// record can be made for it and the export can sign it. Safe to run again: it only adds what's missing.
//   node asc-bundle-id.mjs <bundle id> <name>
// Runs in the build repository (capacitor-testflight.yml) with the App Store Connect key from the environment
// (ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID), never printed.
import crypto from "node:crypto";

const [bundle, name] = process.argv.slice(2);
if (!/^[A-Za-z0-9.-]+$/.test(bundle || "") || !name) { console.log("usage: node asc-bundle-id.mjs <bundle id> <name>"); process.exit(1); }

const b64u = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" }));
const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: process.env.ASC_KEY_P8, dsaEncoding: "ieee-p1363" });
const token = head + "." + body + "." + b64u(sig);

async function api(method, path, data) {
  const r = await fetch("https://api.appstoreconnect.apple.com" + path, {
    method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) { console.log(method, path, r.status, JSON.stringify(json?.errors ?? text).slice(0, 600)); throw new Error("App Store Connect answered " + r.status); }
  return json;
}

const found = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&limit=20`);
if ((found.data || []).some((b) => b.attributes.identifier === bundle)) console.log("App ID already registered:", bundle);
else {
  const made = await api("POST", "/v1/bundleIds", { data: { type: "bundleIds", attributes: { identifier: bundle, name, platform: "IOS" } } });
  console.log("App ID registered:", bundle, made.data.id);
}

// Capabilities (D22): every capability the app's entitlements file asks for is switched on for the App ID, so the
// export's cloud signing can make a profile that includes it. Optional third argument: the .entitlements file.
//   node asc-bundle-id.mjs <bundle id> <name> [path/to/App.entitlements]
const entPath = process.argv[4];
if (entPath) {
  const { execFileSync } = await import("node:child_process");
  const ent = JSON.parse(execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", entPath], { encoding: "utf8" }));
  const WANT = {
    "com.apple.developer.applesignin": { capabilityType: "APPLE_ID_AUTH", settings: [{ key: "APPLE_ID_AUTH_APP_CONSENT", options: [{ key: "PRIMARY_APP_CONSENT" }] }] },
    "com.apple.developer.associated-domains": { capabilityType: "ASSOCIATED_DOMAINS" },
    "com.apple.developer.game-center": { capabilityType: "GAME_CENTER" },
    "com.apple.developer.ubiquity-kvstore-identifier": { capabilityType: "ICLOUD", settings: [{ key: "ICLOUD_VERSION", options: [{ key: "XCODE_6", enabled: true }] }] },
  };
  const ids = await api("GET", `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundle)}&include=bundleIdCapabilities&limit=20`);
  const b = (ids.data || []).find((x) => x.attributes.identifier === bundle);
  if (!b) throw new Error("no App ID " + bundle);
  const mine = new Set((b.relationships?.bundleIdCapabilities?.data ?? []).map((r) => r.id));
  const have = new Set((ids.included ?? []).filter((c) => c.type === "bundleIdCapabilities" && mine.has(c.id)).map((c) => c.attributes.capabilityType));
  for (const key of Object.keys(ent)) {
    const cap = WANT[key];
    if (!cap) continue;
    if (have.has(cap.capabilityType)) { console.log(cap.capabilityType, "already on"); continue; }
    await api("POST", "/v1/bundleIdCapabilities", { data: { type: "bundleIdCapabilities", attributes: cap, relationships: { bundleId: { data: { type: "bundleIds", id: b.id } } } } });
    console.log(cap.capabilityType, "switched on for", bundle);
  }
}
