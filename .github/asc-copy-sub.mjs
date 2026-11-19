// Makes a new auto-renewing subscription as an exact copy of an existing one in the same group: the period, family
// sharing, review note, localisations, territories, every territory's price (Apple's equalised prices from the base
// territory's price) and the review screenshot. For a product the sandbox won't serve (Listem, 19 Nov 2026: Casual
// never loaded in TestFlight although it was set up exactly like Premium). Safe to run again: it only adds what's missing.
//   node asc-copy-sub.mjs <bundle id> <from product id> <new product id> <new reference name> [base territory, GBR]
// Runs in the build repository (asc-copy-sub.yml) with the App Store Connect key from the environment
// (ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID), never printed.
import crypto from "node:crypto";

const [bundle, fromId, toId, refName, base = "GBR"] = process.argv.slice(2);
const idOk = (s) => /^[A-Za-z0-9._-]+$/.test(s || "");
if (!idOk(bundle) || !idOk(fromId) || !idOk(toId) || !refName || fromId === toId) {
  console.log("usage: node asc-copy-sub.mjs <bundle id> <from product id> <new product id> <new reference name> [base territory]"); process.exit(1);
}

const b64u = (b) => Buffer.from(b).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const head = b64u(JSON.stringify({ alg: "ES256", kid: process.env.ASC_KEY_ID, typ: "JWT" }));
const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" }));
const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key: process.env.ASC_KEY_P8, dsaEncoding: "ieee-p1363" });
const token = head + "." + body + "." + b64u(sig);
const HOST = "https://api.appstoreconnect.apple.com";

async function api(method, path, data, { soft = false } = {}) {
  const r = await fetch(path.startsWith("http") ? path : HOST + path, {
    method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  if (!r.ok) {
    const why = `${method} ${path.replace(HOST, "")} ${r.status} ${JSON.stringify(json?.errors?.map((e) => e.code + ": " + (e.detail || e.title)) ?? text).slice(0, 700)}`;
    if (soft) return { error: why, status: r.status };
    console.log(why); throw new Error("App Store Connect answered " + r.status);
  }
  return json || {};
}
async function all(path) {
  const out = []; const included = [];
  let next = path;
  while (next) { const page = await api("GET", next); out.push(...(page.data || [])); included.push(...(page.included || [])); next = page.links?.next || null; }
  return { data: out, included };
}
const rel = (type, id) => ({ data: { type, id } });

// ---- The app, the group and the subscription to copy
const app = (await api("GET", `/v1/apps?filter[bundleId]=${encodeURIComponent(bundle)}`)).data?.find((a) => a.attributes.bundleId === bundle);
if (!app) { console.log("No app for", bundle); process.exit(1); }
const groups = (await all(`/v1/apps/${app.id}/subscriptionGroups?limit=50`)).data;
let from = null, group = null, existing = null;
for (const g of groups) {
  for (const s of (await all(`/v1/subscriptionGroups/${g.id}/subscriptions?limit=50`)).data) {
    if (s.attributes.productId === fromId) { from = s; group = g; }
    if (s.attributes.productId === toId) existing = s;
  }
}
if (!from) { console.log("No subscription", fromId); process.exit(1); }
const fa = from.attributes;
console.log(`Copying "${fa.name}" (${fromId}, ${fa.state}) in group "${group.attributes.referenceName}" to ${toId}`);

// ---- 1. The subscription itself
let sub = existing;
if (sub) console.log("1. Already made:", sub.id, sub.attributes.state);
else {
  sub = (await api("POST", "/v1/subscriptions", { data: { type: "subscriptions",
    attributes: { name: refName, productId: toId, familySharable: fa.familySharable, subscriptionPeriod: fa.subscriptionPeriod, reviewNote: fa.reviewNote },
    relationships: { group: rel("subscriptionGroups", group.id) } } })).data;
  console.log("1. Made subscription", sub.id, "level", sub.attributes.groupLevel);
}

// ---- 2. Localisations
const haveLoc = new Set((await all(`/v1/subscriptions/${sub.id}/subscriptionLocalizations?limit=50`)).data.map((l) => l.attributes.locale));
for (const l of (await all(`/v1/subscriptions/${from.id}/subscriptionLocalizations?limit=50`)).data) {
  const { locale, name, description } = l.attributes;
  if (haveLoc.has(locale)) { console.log("2. Localisation", locale, "already there"); continue; }
  await api("POST", "/v1/subscriptionLocalizations", { data: { type: "subscriptionLocalizations",
    attributes: { locale, name, description }, relationships: { subscription: rel("subscriptions", sub.id) } } });
  console.log("2. Localisation", locale, JSON.stringify(name));
}

// ---- 3. Territories
const fromAv = await api("GET", `/v1/subscriptions/${from.id}/subscriptionAvailability`, null, { soft: true });
const territories = fromAv.data ? (await all(`/v1/subscriptionAvailabilities/${fromAv.data.id}/availableTerritories?limit=50`)).data.map((t) => t.id) : [];
const toAv = await api("GET", `/v1/subscriptions/${sub.id}/subscriptionAvailability`, null, { soft: true });
if (toAv.data) console.log("3. Availability already set");
else if (!territories.length) console.log("3. The original has no availability; skipped");
else {
  await api("POST", "/v1/subscriptionAvailabilities", { data: { type: "subscriptionAvailabilities",
    attributes: { availableInNewTerritories: fromAv.data.attributes.availableInNewTerritories },
    relationships: { subscription: rel("subscriptions", sub.id), availableTerritories: { data: territories.map((id) => ({ type: "territories", id })) } } } });
  console.log("3. Availability:", territories.length, "territories");
}

// ---- 4. Prices: the original's current price in each territory, matched to the new subscription's own price points
const fromPrices = await all(`/v1/subscriptions/${from.id}/prices?limit=200&include=subscriptionPricePoint,territory`);
const pts = Object.fromEntries(fromPrices.included.filter((i) => i.type === "subscriptionPricePoints").map((i) => [i.id, i.attributes]));
const want = {}; // territory -> customerPrice (current rows only: no start date or one already passed)
for (const p of fromPrices.data) {
  const t = p.relationships?.territory?.data?.id; const pp = pts[p.relationships?.subscriptionPricePoint?.data?.id];
  if (!t || !pp) continue;
  const start = p.attributes.startDate ? Date.parse(p.attributes.startDate) : 0;
  if (start <= Date.now() && (!want[t] || start >= want[t].start)) want[t] = { price: pp.customerPrice, start };
}
const havePrices = new Set((await all(`/v1/subscriptions/${sub.id}/prices?limit=200&include=territory`)).data.map((p) => p.relationships?.territory?.data?.id));
const basePrice = want[base]?.price;
if (!basePrice) { console.log("4. The original has no", base, "price; stopping"); process.exit(1); }
const basePoint = (await all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${base}&limit=200`)).data.find((p) => p.attributes.customerPrice === basePrice);
if (!basePoint) { console.log("4. No", base, "price point at", basePrice); process.exit(1); }
const eq = await all(`/v1/subscriptionPricePoints/${basePoint.id}/equalizations?limit=200&include=territory`);
const pointFor = { [base]: basePoint };
for (const p of eq.data) { const t = p.relationships?.territory?.data?.id; if (t) pointFor[t] = p; }

let made = 0, skipped = 0, differ = 0; const failed = [];
for (const [t, w] of Object.entries(want)) {
  if (havePrices.has(t)) { skipped++; continue; }
  let point = pointFor[t];
  if (!point || point.attributes.customerPrice !== w.price) {
    // Apple's equalised price differs from the original's here: use the original's exact price in this territory.
    point = (await all(`/v1/subscriptions/${sub.id}/pricePoints?filter[territory]=${t}&limit=200`)).data.find((p) => p.attributes.customerPrice === w.price);
    differ++;
  }
  if (!point) { failed.push(t + " (no point at " + w.price + ")"); continue; }
  const r = await api("POST", "/v1/subscriptionPrices", { data: { type: "subscriptionPrices",
    attributes: { startDate: null, preserveCurrentPrice: false },
    relationships: { subscription: rel("subscriptions", sub.id), subscriptionPricePoint: rel("subscriptionPricePoints", point.id), territory: rel("territories", t) } } }, { soft: true });
  if (r.error) { failed.push(t + " " + r.error); if (failed.length === 1) console.log("   first failure:", r.error); if (failed.length >= 5 && made === 0) break; }
  else made++;
}
console.log(`4. Prices: ${made} set, ${skipped} already there, ${differ} matched by exact price, ${failed.length} failed`);
if (failed.length) console.log("   failed:", failed.slice(0, 10).join(" | "));

// ---- 5. Review screenshot: the original's image, downloaded from Apple and uploaded again
const toShot = await api("GET", `/v1/subscriptions/${sub.id}/appStoreReviewScreenshot`, null, { soft: true });
const fromShot = await api("GET", `/v1/subscriptions/${from.id}/appStoreReviewScreenshot`, null, { soft: true });
if (toShot.data && toShot.data.attributes.assetDeliveryState?.state === "COMPLETE") console.log("5. Review screenshot already there");
else if (!fromShot.data?.attributes?.imageAsset) console.log("5. The original has no review screenshot; skipped");
else {
  const a = fromShot.data.attributes;
  const url = a.imageAsset.templateUrl.replace("{w}", a.imageAsset.width).replace("{h}", a.imageAsset.height).replace("{f}", "png");
  const img = Buffer.from(await (await fetch(url)).arrayBuffer());
  const fileName = (a.fileName || "review.png").replace(/\.[a-z]+$/i, "") + ".png";
  if (toShot.data) await api("DELETE", `/v1/subscriptionAppStoreReviewScreenshots/${toShot.data.id}`, null, { soft: true }); // a failed earlier upload
  const res = (await api("POST", "/v1/subscriptionAppStoreReviewScreenshots", { data: { type: "subscriptionAppStoreReviewScreenshots",
    attributes: { fileName, fileSize: img.length }, relationships: { subscription: rel("subscriptions", sub.id) } } })).data;
  for (const op of res.attributes.uploadOperations || []) {
    const headers = Object.fromEntries((op.requestHeaders || []).map((h) => [h.name, h.value]));
    const put = await fetch(op.url, { method: op.method, headers, body: img.subarray(op.offset, op.offset + op.length) });
    if (!put.ok) { console.log("5. Upload part answered", put.status); process.exit(1); }
  }
  await api("PATCH", `/v1/subscriptionAppStoreReviewScreenshots/${res.id}`, { data: { type: "subscriptionAppStoreReviewScreenshots", id: res.id,
    attributes: { uploaded: true, sourceFileChecksum: crypto.createHash("md5").update(img).digest("hex") } } });
  console.log(`5. Review screenshot uploaded (${a.imageAsset.width}x${a.imageAsset.height}, ${img.length} bytes)`);
}

const after = (await api("GET", `/v1/subscriptions/${sub.id}`)).data.attributes;
console.log(`Done: ${toId} is ${after.state}, group level ${after.groupLevel}`);
if (failed.length) process.exit(2);
