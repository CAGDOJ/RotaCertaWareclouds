const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const elements = new Map();
function el(id) { if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', listeners: {}, addEventListener(type, cb) { this.listeners[type] = cb; } }); return elements.get(id); }
const store = new Map(), requests = [], shared = [];
let gps, heartbeat, cleared = false;
const session = { routeId: '12345678-1234-1234-1234-123456789012', ownerToken: 'a'.repeat(64), links: [{ id: 'a', token: 'b'.repeat(64) }, { id: 'b', token: 'c'.repeat(64) }], expiresAt: Date.now() + 3600000 };
const context = {
  window: {}, document: { getElementById: el }, location: { origin: 'https://cagdoj.github.io', pathname: '/RotaCertaWareclouds/' },
  localStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
  navigator: { geolocation: { watchPosition(cb) { gps = cb; return 1; }, clearWatch() { cleared = true; } }, share: async data => shared.push(data) },
  fetch: async (url, options) => { if (url.includes('project-osrm')) return Response.json({ code: 'Ok', routes: [{ duration: 500 }] }); const body = JSON.parse(options.body); requests.push(body); return Response.json(body.action === 'start' ? session : { ok: true }); },
  AbortSignal, Date, console, setInterval(cb) { heartbeat = cb; return 1; }, clearInterval() {},
};
vm.runInNewContext(fs.readFileSync('dist/driver-tracking.js', 'utf8'), context);
const stops = [{ id: 'a', orderRef: 'Pedido A', street: 'Rua A', municipality: 'Belém', lat: -1.45, lon: -48.49, done: false }, { id: 'b', orderRef: 'Pedido B', street: 'Rua B', municipality: 'Belém', lat: -1.46, lon: -48.48, done: false }];
const click = selector => el('customerTracking').listeners.click({ target: { closest: s => s === selector ? {} : null } });
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  context.window.RouteTracking.sync(stops, { duration: 1200, durations: [500, 700] });
  await click('#startTracking'); await flush();
  assert.equal(requests[0].action, 'start'); assert.equal(requests[0].stops.length, 2); assert(gps);
  await gps({ coords: { latitude: -1.451, longitude: -48.491, accuracy: 10 }, timestamp: Date.now() });
  heartbeat(); await flush();
  const update = requests.filter(r => r.action === 'update').at(-1);
  assert.equal(update.position.lat, -1.451); assert(update.position.observedAt); assert(update.etas.a);
  context.window.RouteTracking.sync([{ ...stops[0], done: true }, stops[1]], { duration: 1200, durations: [500, 700] }); await flush();
  assert.deepEqual(Array.from(requests.filter(r => r.action === 'update').at(-1).doneIds), ['a']);
  await el('customerTracking').listeners.click({ target: { closest: s => s === '[data-tracking-link]' ? { dataset: { trackingLink: 'b' } } : null } });
  assert(shared[0].url.startsWith('https://cagdoj.github.io/RotaCertaWareclouds/acompanhar.html#'));
  assert(!shared[0].url.includes(session.ownerToken)); assert(shared[0].url.includes(session.links[1].token));
  await click('#stopTracking'); assert(cleared); assert.equal(requests.at(-1).action, 'stop'); assert.equal(store.size, 0);
  console.log('Driver flow: GPS, ETA, completed stops, individual GitHub link sharing and stop passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
