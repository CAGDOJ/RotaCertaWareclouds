import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handleTracking } from '../lib/tracking.mjs';
const sql = new DatabaseSync(':memory:');
sql.exec('CREATE TABLE tracking_sessions (id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL)');
const db = { prepare(statement) { let args = []; return { bind(...values) { args = values; return this; }, async run() { const result = sql.prepare(statement).run(...args); return { meta: { changes: Number(result.changes) } }; }, async first() { return sql.prepare(statement).get(...args); } }; } };
const origin = 'https://cagdoj.github.io', url = 'https://rotacerta-mobile.carlosjralfa.chatgpt.site/api/tracking', now = Date.now();
async function post(body, auth, time = now) {
  return handleTracking(new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) }), db, { now: time, limiter: () => true });
}
const started = await post({ action: 'start', stops: [
  { id: 'a', orderRef: 'Pedido A', street: 'Rua A', municipality: 'Belém', lat: -1.45, lon: -48.49 },
  { id: 'b', orderRef: 'Pedido B', street: 'Rua B', municipality: 'Belém', lat: -1.46, lon: -48.48 }
] });
assert.equal(started.status, 201);
const session = await started.json();
async function read(index, time = now) { const r = await handleTracking(new Request(`${url}?route=${session.routeId}`, { headers: { Origin: origin, Authorization: `Bearer ${session.links[index].token}` } }), db, { now: time }); return { status: r.status, data: await r.json() }; }
const row = sql.prepare('SELECT * FROM tracking_sessions').get();
assert(!row.payload.includes(session.links[0].token)); assert(!row.owner_hash.includes(session.ownerToken));
const update = { action: 'update', routeId: session.routeId, orderIds: ['a', 'b'], doneIds: [], position: { lat: -1.451, lon: -48.49, accuracy: 20, observedAt: now }, etas: { a: now + 600000, b: now + 1200000 } };
assert.equal((await post(update, session.ownerToken)).status, 200);
const first = (await read(0)).data, second = (await read(1)).data;
assert.equal(first.status, 'nearby'); assert(first.position);
assert.equal(second.status, 'waiting'); assert.equal(second.position, null);
assert(!JSON.stringify(second).includes('Rua A')); assert(!JSON.stringify(second).includes(session.ownerToken)); assert(!('stops' in second));
assert.equal((await post(update, session.links[1].token)).status, 403);
assert.equal((await read(0, now + 61000)).data.position, null);
assert.equal((await post({ ...update, doneIds: ['a'] }, session.ownerToken)).status, 200);
assert.equal((await read(0)).data.status, 'delivered'); assert.equal((await read(0)).data.position, null);
assert.equal((await read(1)).data.status, 'next'); assert((await read(1)).data.position);
assert.equal((await post({ ...update, doneIds: ['a'], position: { ...update.position, observedAt: now - 61000 } }, session.ownerToken)).status, 200);
assert.equal((await read(1)).data.position, null);
assert.equal((await post({ action: 'stop', routeId: session.routeId }, session.ownerToken)).status, 200);
assert.equal((await read(1)).data.status, 'ended'); assert.equal((await read(1)).data.position, null);
assert.equal((await post(update, session.ownerToken)).status, 409);
assert.equal((await read(1, now + 25 * 3600000)).status, 410);
console.log('Tracking: individual links, next-stop privacy, owner authorization, stale GPS, completion, stop and expiry passed.');
