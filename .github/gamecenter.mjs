// Yuzu Spa Rush's Game Center setup in App Store Connect (D8, owner: "well if its free do whatever"): switches Game
// Center on for the app and adds the leaderboards the game reports to (Systems/Ranks.cs):
//   weekly_guests  "Guests this week"  most recent score, highest first (the weekly board with placement rewards)
//   furthest_wave  "Waves reached"     best score, highest first ((map − 1) × 50 + wave)
// Runs in the build repository (Mackzr/throne-ladder-ios, .github/workflows/gamecenter.yml) with its App Store Connect
// key: env ASC_KEY_P8, ASC_KEY_ID, ASC_ISSUER_ID, never printed. Safe to run again: it only adds what's missing.
import crypto from 'node:crypto';

const BUNDLE = 'com.sullifishstudios.yuzusparush';
const BOARDS = [
  { id: 'weekly_guests', name: 'Guests this week', submission: 'MOST_RECENT_SCORE' },
  { id: 'furthest_wave', name: 'Waves reached', submission: 'BEST_SCORE' },
];

const b64u = b => Buffer.from(b).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: process.env.ASC_KEY_ID, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: process.env.ASC_ISSUER_ID, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }));
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: process.env.ASC_KEY_P8, dsaEncoding: 'ieee-p1363' });
  return head + '.' + body + '.' + b64u(sig);
}
const T = token();

async function api(method, path, body) {
  const r = await fetch('https://api.appstoreconnect.apple.com' + path, {
    method, headers: { Authorization: 'Bearer ' + T, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { }
  if (!r.ok && !(method === 'GET' && r.status === 404)) {
    console.log(method, path, r.status, JSON.stringify(json?.errors ?? text).slice(0, 800));
    throw new Error('App Store Connect answered ' + r.status);
  }
  return { status: r.status, json };
}

const app = (await api('GET', `/v1/apps?filter[bundleId]=${BUNDLE}`)).json.data[0];
if (!app) throw new Error('no app with the bundle id ' + BUNDLE);
console.log('app', app.id, app.attributes.name);

let gcd = (await api('GET', `/v1/apps/${app.id}/gameCenterDetail`)).json?.data;
if (!gcd) {
  gcd = (await api('POST', '/v1/gameCenterDetails', { data: { type: 'gameCenterDetails', relationships: { app: { data: { type: 'apps', id: app.id } } } } })).json.data;
  console.log('Game Center switched on:', gcd.id);
} else console.log('Game Center already on:', gcd.id);

const existing = (await api('GET', `/v1/gameCenterDetails/${gcd.id}/gameCenterLeaderboards?limit=200`)).json?.data ?? [];
const have = new Set(existing.map(l => l.attributes.vendorIdentifier));
for (const b of BOARDS) {
  if (have.has(b.id)) { console.log('leaderboard already there:', b.id); continue; }
  const lb = (await api('POST', '/v1/gameCenterLeaderboards', {
    data: {
      type: 'gameCenterLeaderboards',
      attributes: { referenceName: b.name, vendorIdentifier: b.id, defaultFormatter: 'INTEGER', submissionType: b.submission, scoreSortType: 'DESC' },
      relationships: { gameCenterDetail: { data: { type: 'gameCenterDetails', id: gcd.id } } },
    },
  })).json.data;
  console.log('leaderboard made:', b.id, lb.id);
  await api('POST', '/v1/gameCenterLeaderboardLocalizations', {
    data: {
      type: 'gameCenterLeaderboardLocalizations', attributes: { locale: 'en-GB', name: b.name },
      relationships: { gameCenterLeaderboard: { data: { type: 'gameCenterLeaderboards', id: lb.id } } },
    },
  });
  console.log('  named (en-GB):', b.name);
}
console.log('done');
