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
