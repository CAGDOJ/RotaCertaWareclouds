import assert from 'node:assert/strict';
import { handleImport, sanitizeOrders } from '../lib/wareclouds.mjs';
const endpoint = 'https://rotacerta-mobile.carlosjralfa.chatgpt.site/api/wareclouds/import';
const origin = 'https://cagdoj.github.io';
const credentials = { username: 'test-user', password: 'test-password' };
const orders = { data: { orders: [{
  id_order: 901, order_code: 'PED-901', consumer_address: 'PSG PERPETUO SOCORRO,185',
  consumer_city: 'Belém', consumer_postal_code: '66040400', consumer_address_detail: 'Casa 2',
  consumer_address_extra_info: 'Portão azul', consumer_first_name: 'NEVER_FORWARD_NAME',
  consumer_phone: 'NEVER_FORWARD_PHONE', consumer_email: 'NEVER_FORWARD_EMAIL'
}], count: 1, total_pages: 1 } };
const request = (body = credentials, headers = {}) => new Request(endpoint, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const calls = [];
const fetcher = async (url, options) => {
  calls.push({ url, ...options });
  return Response.json(calls.length === 1 ? { data: { accessToken: 'fixture-token', refreshToken: 'NEVER_FORWARD_TOKEN' } } : orders);
};
const result = await handleImport(request(), { fetcher, limiter: () => true });
assert.equal(result.status, 200);
assert.equal(result.headers.get('Cache-Control'), 'no-store');
assert.equal(result.headers.get('Access-Control-Allow-Origin'), origin);
const data = await result.json();
assert.equal(data.count, 1);
assert.equal(data.stops[0].postalCode, '66040-400');
assert.equal(data.stops[0].addressDetail, 'Casa 2');
assert.equal(data.stops[0].note, 'Portão azul');
assert(!JSON.stringify(data).includes('NEVER_FORWARD'));
assert(!JSON.stringify(data).includes('test-password'));
assert.equal(calls.length, 2);
assert.equal(calls[0].method, 'POST');
assert.equal(calls[0].headers.Authorization, `Basic ${btoa('test-user:test-password')}`);
assert.equal(calls[0].redirect, 'manual');
assert.equal(calls[1].method, 'GET');
assert(calls[1].url.endsWith('?filter=&id_city='));
assert.equal(calls[1].headers.Authorization, 'Bearer fixture-token');
const unauthorized = await handleImport(request(), { fetcher: async () => new Response('upstream_private_details', { status: 401 }), limiter: () => true });
assert.equal(unauthorized.status, 401);
assert(!(await unauthorized.text()).includes('upstream_private_details'));
const wrongOrigin = await handleImport(request(credentials, { Origin: 'https://evil.example' }), { fetcher: () => assert.fail('must not call upstream') });
assert.equal(wrongOrigin.status, 403);
assert.equal(wrongOrigin.headers.get('Access-Control-Allow-Origin'), null);
const invalid = await handleImport(request({ username: 'bad:user', password: 'x' }), { limiter: () => true, fetcher: () => assert.fail('must not call upstream') });
assert.equal(invalid.status, 400);
const limited = await handleImport(request(), { limiter: () => false, fetcher: () => assert.fail('must not call upstream') });
assert.equal(limited.status, 429);
const oversized = await handleImport(request({ ...credentials, extra: 'x'.repeat(5000) }), { limiter: () => true, fetcher: () => assert.fail('must not call upstream') });
assert.equal(oversized.status, 413);
const preflight = await handleImport(new Request(endpoint, { method: 'OPTIONS', headers: { Origin: origin } }));
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
assert.deepEqual(sanitizeOrders({ data: { orders: [], count: 0 } }).stops, []);
assert.throws(() => sanitizeOrders({ data: { orders: orders.data.orders, count: 2 } }), /incompleta/);
assert.throws(() => sanitizeOrders({ data: { orders: [{ id_order: 1, consumer_city: 'Belém' }], count: 1 } }), /sem endereço/);
console.log('Wareclouds authentication, full address import, privacy, CORS and failure checks passed.');
const flatLogin = await handleImport(request(), { limiter: () => true, fetcher: async url => Response.json(url.includes('/login/') ? { accessToken: 'fixture-token' } : orders) });
assert.equal(flatLogin.status, 200);
const connectionFailure = await handleImport(request(), { limiter: () => true, fetcher: async () => { throw new TypeError('NEVER_FORWARD_PRIVATE_ERROR'); } });
assert.equal(connectionFailure.status, 502);
const failedConnectionData = await connectionFailure.json();
assert.equal(failedConnectionData.code, 'CONNECTION_LOGIN');
assert(!JSON.stringify(failedConnectionData).includes('NEVER_FORWARD'));
