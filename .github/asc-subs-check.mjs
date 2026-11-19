// READ-ONLY: prints how every auto-renewing subscription of an app is set up in App Store Connect, so two plans can be
// compared field by field (Listem, 19 Nov 2026: Casual never loaded in TestFlight while Premium did). Only GET calls.
//   node asc-subs-check.mjs <bundle id> [territory, default GBR]
// Runs in the build repository (asc-subs-check.yml) with the App Store Connect key from the environment
// (ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID), never printed.
import crypto from "node:crypto";

const [bundle, territory = "GBR"] = process.argv.slice(2);
if (!/^[A-Za-z0-9.-]+$/.test(bundle || "")) { console.log("usage: node asc-subs-check.mjs <bundle id> [territory]"); process.exit(1); }

const b64u = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" }));
const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: process.env.ASC_KEY_P8, dsaEncoding: "ieee-p1363" });
const token = head + "." + body + "." + b64u(sig);

async function get(path) {
  const r = await fetch("https://api.appstoreconnect.apple.com" + path, { headers: { Authorization: "Bearer " + token } });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) return { error: r.status + " " + JSON.stringify(json?.errors?.map((e) => e.detail || e.title) ?? text).slice(0, 300) };
  return json;
}
const show = (label, v) => console.log("  " + label.padEnd(26) + (typeof v === "string" ? v : JSON.stringify(v)));
// Reveals hidden characters (spaces, look-alike letters) in an identifier.
const exact = (s) => JSON.stringify(s) + ([...(s || "")].some((c) => c.charCodeAt(0) > 126 || c === " ") ? "  <-- UNUSUAL CHARACTERS" : "");

const apps = await get(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}&fields[apps]=name,bundleId,primaryLocale`);
const app = (apps.data || []).find((a) => a.attributes.bundleId === bundle);
if (!app) { console.log("No app for", bundle, apps.error || ""); process.exit(1); }
console.log(`App ${app.attributes.name} (${app.id}), primary locale ${app.attributes.primaryLocale}`);

const agr = await get(`/v1/apps/${app.id}/inAppPurchasesV2?limit=50&fields[inAppPurchases]=productId,name,state,inAppPurchaseType`);
console.log("Other in-app purchases:", agr.error || (agr.data || []).map((i) => `${i.attributes.productId} ${i.attributes.inAppPurchaseType} ${i.attributes.state}`).join(", ") || "none");

const groups = await get(`/v1/apps/${app.id}/subscriptionGroups?limit=50`);
if (groups.error) { console.log("subscriptionGroups:", groups.error); process.exit(1); }
for (const g of groups.data || []) {
  console.log(`\nGroup "${g.attributes.referenceName}" (${g.id})`);
  const gl = await get(`/v1/subscriptionGroups/${g.id}/subscriptionGroupLocalizations?limit=50`);
  for (const l of gl.data || []) show("group localisation", `${l.attributes.locale} "${l.attributes.name}" ${l.attributes.state}`);
  if (gl.error) show("group localisations", gl.error);

  const subs = await get(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`);
  if (subs.error) { show("subscriptions", subs.error); continue; }
  for (const s of subs.data || []) {
    const a = s.attributes;
    console.log(`\n Subscription "${a.name}" (${s.id})`);
    show("productId", exact(a.productId));
    for (const k of ["state", "groupLevel", "subscriptionPeriod", "familySharable", "availableInAllTerritories"]) show(k, a[k] ?? "(none)");
    show("reviewNote", a.reviewNote ? `${a.reviewNote.length} characters` : "(none)");

    const loc = await get(`/v1/subscriptions/${s.id}/subscriptionLocalizations?limit=50`);
    if (loc.error) show("localisations", loc.error);
    for (const l of loc.data || []) show("localisation", `${l.attributes.locale} "${l.attributes.name}" (${(l.attributes.description || "").length} ch) ${l.attributes.state}`);

    const av = await get(`/v1/subscriptions/${s.id}/subscriptionAvailability?include=availableTerritories&limit[availableTerritories]=200`);
    if (av.error) show("availability", av.error);
    else {
      const terr = (av.data?.relationships?.availableTerritories?.data || []).map((t) => t.id);
      show("availability", `${terr.length} territories, ${territory} ${terr.includes(territory) ? "yes" : "NO"}, new territories ${av.data?.attributes?.availableInNewTerritories}`);
    }

    const pr = await get(`/v1/subscriptions/${s.id}/prices?filter[territory]=${territory}&include=subscriptionPricePoint,territory&limit=20`);
    if (pr.error) show("prices", pr.error);
    else {
      const pts = Object.fromEntries((pr.included || []).filter((i) => i.type === "subscriptionPricePoints").map((i) => [i.id, i.attributes]));
      if (!(pr.data || []).length) show(`price ${territory}`, "NONE");
      for (const p of pr.data || []) {
        const pt = pts[p.relationships?.subscriptionPricePoint?.data?.id] || {};
        show(`price ${territory}`, `${pt.customerPrice} (proceeds ${pt.proceeds}) start ${p.attributes.startDate || "-"} preserved ${p.attributes.preserved}`);
      }
    }
    const all = await get(`/v1/subscriptions/${s.id}/prices?limit=200&fields[subscriptionPrices]=startDate`);
    show("price rows (all territories)", all.error || `${(all.data || []).length}${all.links?.next ? "+" : ""}`);

    const shot = await get(`/v1/subscriptions/${s.id}/appStoreReviewScreenshot`);
    show("review screenshot", shot.error || (shot.data ? `${shot.data.attributes.fileName} ${shot.data.attributes.assetDeliveryState?.state}` : "(none)"));
    const intro = await get(`/v1/subscriptions/${s.id}/introductoryOffers?limit=50`);
    show("introductory offers", intro.error || (intro.data || []).length);
    const promo = await get(`/v1/subscriptions/${s.id}/promotionalOffers?limit=50`);
    show("promotional offers", promo.error || (promo.data || []).length);
    const ps = await get(`/v1/subscriptions/${s.id}/promotedPurchase`);
    show("promoted purchase", ps.error || (ps.data ? `${ps.data.attributes.state} visible ${ps.data.attributes.visibleForAllUsers} enabled ${ps.data.attributes.enabled}` : "(none)"));
  }
}
