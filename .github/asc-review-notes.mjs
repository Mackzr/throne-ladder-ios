// The notes App Review reads: the app version's review notes and each subscription's review note.
//   node asc-review-notes.mjs <bundle id> <version>                    (read: prints the notes, emails masked)
//   node asc-review-notes.mjs <bundle id> <version> --sub-note "text"  (sets every subscription's review note)
// Never prints the demo account's name or password, or the contact details (the log of a public repository).
// Runs in the build repository (asc-review-notes.yml) with the App Store Connect key from the environment.
import crypto from "node:crypto";

const [bundle, version, flag, subNote] = process.argv.slice(2);
if (!/^[A-Za-z0-9.-]+$/.test(bundle || "") || !/^[0-9.]+$/.test(version || "") || (flag && (flag !== "--sub-note" || !subNote))) {
  console.log('usage: node asc-review-notes.mjs <bundle id> <version> [--sub-note "text"]'); process.exit(1);
}
const b64u = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" }));
const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: process.env.ASC_KEY_P8, dsaEncoding: "ieee-p1363" });
const token = head + "." + body + "." + b64u(sig);
async function api(method, path, data) {
  const r = await fetch("https://api.appstoreconnect.apple.com" + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) { console.log(method, path, r.status, JSON.stringify(json?.errors?.map((e) => e.detail || e.title) ?? text).slice(0, 400)); throw new Error("App Store Connect answered " + r.status); }
  return json || {};
}
const mask = (s) => (s || "").replace(/[^\s@]+@[^\s@]+\.[a-z]{2,}/gi, "[email]").replace(/(password\s*[:=]?\s*)\S+/gi, "$1[hidden]");

const app = (await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`)).data?.find((a) => a.attributes.bundleId === bundle);
if (!app) { console.log("No app for", bundle); process.exit(1); }
const ver = (await api("GET", `/v1/apps/${app.id}/appStoreVersions?filter[versionString]=${version}&filter[platform]=IOS`)).data?.[0];
if (!ver) console.log("No version", version);
else {
  const rd = await api("GET", `/v1/appStoreVersions/${ver.id}/appStoreReviewDetail?fields[appStoreReviewDetails]=notes,demoAccountRequired`).catch(() => ({}));
  console.log(`Version ${version} (${ver.attributes.appStoreState}), demo account required: ${rd.data?.attributes?.demoAccountRequired}`);
  console.log("Version review notes:\n" + mask(rd.data?.attributes?.notes || "(none)").split("\n").map((l) => "  | " + l).join("\n"));
}
for (const g of (await api("GET", `/v1/apps/${app.id}/subscriptionGroups?limit=50`)).data || []) {
  for (const s of (await api("GET", `/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`)).data || []) {
    if (flag === "--sub-note" && s.attributes.reviewNote !== subNote) {
      await api("PATCH", `/v1/subscriptions/${s.id}`, { data: { type: "subscriptions", id: s.id, attributes: { reviewNote: subNote } } });
      console.log(`${s.attributes.productId}: review note SET`);
    }
    const now = flag === "--sub-note" ? subNote : s.attributes.reviewNote;
    console.log(`${s.attributes.productId} review note: ${mask(now || "(none)")}`);
  }
}
