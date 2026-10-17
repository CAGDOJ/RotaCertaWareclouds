const ORIGINS = new Set(['https://cagdoj.github.io', 'https://rotacerta-mobile.carlosjralfa.chatgpt.site']);
const TTL = 24 * 60 * 60 * 1000;
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export async function hashToken(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), n => n.toString(16).padStart(2, '0')).join('');
}
function point(value) {
  if (!value || typeof value.lat !== 'number' || typeof value.lon !== 'number' || !Number.isFinite(value.lat) || !Number.isFinite(value.lon) || Math.abs(value.lat) > 90 || Math.abs(value.lon) > 180) return null;
  return { lat: value.lat, lon: value.lon, accuracy: Number.isFinite(value.accuracy) ? Math.max(0, value.accuracy) : null };
}
function distance(a, b) {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export function customerView(payload, customerHash, now = Date.now()) {
  const stop = payload.stops.find(s => s.customerHash === customerHash);
  if (!stop) return null;
  const next = payload.stops.find(s => !s.done);
  const active = !payload.endedAt && !stop.done && next?.id === stop.id;
  const fresh = active && payload.position && now - payload.updatedAt < 60000;
  const status = stop.done ? 'delivered' : payload.endedAt ? 'ended' : active ? (fresh && distance(payload.position, stop) < 250 ? 'nearby' : 'next') : 'waiting';
  return {
    orderRef: stop.orderRef, street: stop.street, municipality: stop.municipality,
    destination: { lat: stop.lat, lon: stop.lon },
    status, eta: !payload.endedAt && !stop.done ? stop.eta || null : null,
    position: fresh ? payload.position : null, updatedAt: active ? payload.updatedAt || null : null,
  };
}
async function jsonBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Informe os dados do acompanhamento.');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 100000) { await reader.cancel(); throw new Error('A rota excedeu o tamanho permitido.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const attempts = new Map();
function allowCreate(request, now) {
  for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const entry = attempts.get(ip) || { count: 0, until: now + 3600000 };
  if (entry.count >= 20 || attempts.size >= 2000) return false;
  entry.count++; attempts.set(ip, entry); return true;
}
export async function handleTracking(request, db, { now = Date.now(), limiter = allowCreate } = {}) {
  const origin = request.headers.get('Origin');
  const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin', ...(ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}) };
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (origin && !ORIGINS.has(origin)) return reply({ error: 'Abra pelo Rota Certa.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' } });
  if (!db) return reply({ error: 'O acompanhamento está indisponível. Tente novamente em instantes.' }, 503);
  try {
    if (request.method === 'POST' && !ORIGINS.has(origin)) return reply({ error: 'Abra pelo Rota Certa.' }, 403);
    const input = request.method === 'POST' ? await jsonBody(request) : {};
    if (request.method === 'POST' && input.action === 'start') {
      if (!limiter(request, now)) return reply({ error: 'Aguarde antes de criar outro acompanhamento.' }, 429);
      if (!Array.isArray(input.stops) || !input.stops.length || input.stops.length > 100) return reply({ error: 'Selecione de 1 a 100 paradas com localização confirmada.' }, 400);
      const links = [], seen = new Set();
      const stops = [];
      for (const s of input.stops) {
        const p = point(s), id = clean(s.id, 100);
        if (!p || !id || seen.has(id)) return reply({ error: 'Há paradas sem localização ou repetidas. Otimize novamente.' }, 400);
        seen.add(id);
        const customerToken = token();
        links.push({ id, token: customerToken });
        stops.push({ id, orderRef: clean(s.orderRef, 50), street: clean(s.street, 240), municipality: clean(s.municipality, 120), lat: p.lat, lon: p.lon, done: Boolean(s.done), eta: null, customerHash: await hashToken(customerToken) });
      }
      const id = crypto.randomUUID(), ownerToken = token(), expiresAt = now + TTL;
      const payload = { stops, position: null, updatedAt: null, endedAt: null };
      await db.prepare('DELETE FROM tracking_sessions WHERE expires_at < ?').bind(now).run();
      await db.prepare('INSERT INTO tracking_sessions (id, owner_hash, payload, expires_at) VALUES (?, ?, ?, ?)').bind(id, await hashToken(ownerToken), JSON.stringify(payload), expiresAt).run();
      return reply({ routeId: id, ownerToken, links, expiresAt }, 201);
    }
    const id = request.method === 'GET' ? new URL(request.url).searchParams.get('route') : input.routeId;
    const bearer = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if (!bearer || typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return reply({ error: 'Link de acompanhamento inválido.' }, 401);
    const row = await db.prepare('SELECT * FROM tracking_sessions WHERE id = ?').bind(id).first();
    if (!row || row.expires_at <= now) return reply({ error: 'Este acompanhamento expirou. Solicite um novo link ao entregador.' }, 410);
    const auth = await hashToken(bearer), payload = JSON.parse(row.payload);
    if (request.method === 'GET') {
      const view = customerView(payload, auth, now);
      return view ? reply(view) : reply({ error: 'Link de acompanhamento inválido.' }, 404);
    }
    if (request.method !== 'POST' || auth !== row.owner_hash) return reply({ error: 'Acesso de entregador inválido.' }, 403);
    if (input.action === 'stop') {
      payload.endedAt = now; payload.position = null;
    } else if (input.action === 'update' && !payload.endedAt) {
      if (!Array.isArray(input.orderIds) || input.orderIds.length !== payload.stops.length || new Set(input.orderIds).size !== payload.stops.length || input.orderIds.some(id => !payload.stops.some(s => s.id === id))) return reply({ error: 'A rota mudou. Encerre e gere novos links.' }, 409);
      const done = new Set(Array.isArray(input.doneIds) ? input.doneIds : []);
      payload.stops = input.orderIds.map(id => {
        const s = payload.stops.find(s => s.id === id);
        const eta = Number(input.etas?.[id]);
        return { ...s, done: done.has(id), eta: Number.isFinite(eta) && eta >= now && eta < now + TTL ? eta : null };
      });
      const observedAt = input.position?.observedAt;
      payload.position = typeof observedAt === 'number' && observedAt <= now + 10000 && observedAt >= now - 60000 ? point(input.position) : null;
      payload.updatedAt = payload.position ? observedAt : now;
    } else return reply({ error: 'Este acompanhamento já foi encerrado.' }, 409);
    const saved = await db.prepare('UPDATE tracking_sessions SET payload = ? WHERE id = ? AND payload = ?').bind(JSON.stringify(payload), id, row.payload).run();
    if (!saved.meta?.changes) return reply({ error: 'A rota foi atualizada ao mesmo tempo. Tente novamente.' }, 409);
    return reply({ ok: true });
  } catch { return reply({ error: 'Não foi possível atualizar o acompanhamento. Tente novamente.' }, 400); }
}
