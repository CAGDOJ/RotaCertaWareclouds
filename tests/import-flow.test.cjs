const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const storageKey = 'rotacerta.mobile.state.v1';
function setup(fetcher) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, checked: false, open: false,
      classList: { add() {}, remove() {}, toggle() {} }, style: {}, listeners: {},
      addEventListener(name, cb) { this.listeners[name] = cb; },
      scrollIntoView() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const initial = { stops: [{ id: 'old', street: 'Rua antiga, 1', municipality: 'Belém', orderRef: 'antigo', lat: null, lon: null }], orderIds: ['old'] };
  const storage = new Map([[storageKey, JSON.stringify(initial)]]);
  const context = {
    window: { RouteCore: {} }, document: { getElementById: element, querySelectorAll: () => [] },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: {}, location: { hash: '', protocol: 'https:' }, fetch: fetcher,
    URLSearchParams, AbortController, TextDecoder, TextEncoder, console,
    setTimeout: () => 1, clearTimeout() {}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/app.js'), 'utf8'), context);
  return { element, storage };
}
async function main() {
  const fixture = { stops: [{ id: 'wareclouds-1', orderRef: 'PED-1', street: 'PSG Perpetuo Socorro, 185', municipality: 'Belém', postalCode: '66040-400', addressDetail: 'Casa 2', lat: null, lon: null }] };
  const app = setup(async (url, options) => {
    assert(url.startsWith('https://rotacerta-mobile.carlosjralfa.chatgpt.site/'));
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.deepEqual(JSON.parse(options.body), { username: 'fixture-user', password: 'fixture-password' });
    return Response.json(fixture);
  });
  app.element('importWareclouds').listeners.click();
  assert.equal(app.element('warecloudsDialog').open, true);
  app.element('warecloudsUsername').value = 'fixture-user'; app.element('warecloudsPassword').value = 'fixture-password';
  await app.element('warecloudsForm').listeners.submit({ preventDefault() {} });
  const saved = JSON.parse(app.storage.get(storageKey));
  assert.equal(saved.stops[0].postalCode, '66040-400');
  assert.equal(saved.stops[0].addressDetail, 'Casa 2');
  assert.equal(saved.stops[0].lat, null);
  assert.equal(app.element('warecloudsPassword').value, '');
  assert.equal(app.element('warecloudsDialog').open, false);
  assert(![...app.storage.values()].join('').includes('fixture-password'));
  assert(![...app.storage.values()].join('').includes('fixture-user'));
  const failed = setup(async () => Response.json({ error: 'Confira seu login' }, { status: 401 }));
  failed.element('importWareclouds').listeners.click();
  failed.element('warecloudsUsername').value = 'fixture-user'; failed.element('warecloudsPassword').value = 'fixture-password';
  await failed.element('warecloudsForm').listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(failed.storage.get(storageKey)).stops[0].id, 'old');
  assert.equal(failed.element('warecloudsDialog').open, true);
  assert.equal(failed.element('loginStatus').textContent, 'Confira seu login');
  assert.equal(failed.element('warecloudsPassword').value, '');
  assert.equal(failed.element('submitWareclouds').disabled, false);
  const empty = setup(async () => Response.json({ stops: [] }));
  empty.element('importWareclouds').listeners.click(); empty.element('warecloudsUsername').value = 'fixture-user'; empty.element('warecloudsPassword').value = 'fixture-password';
  await empty.element('warecloudsForm').listeners.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(empty.storage.get(storageKey)).stops, []);
  assert(!fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8').includes('favorito'));
  console.log('Mobile login/import flow, CEP, password clearing, old-list preservation and empty orders checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
