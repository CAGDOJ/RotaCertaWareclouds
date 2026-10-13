const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const moduleScope = { exports: {} };
vm.runInNewContext(fs.readFileSync(require("node:path").join(__dirname, "../dist/core.js"), "utf8"), { module: moduleScope, console, TextEncoder, btoa, setTimeout });
const core = moduleScope.exports;
const { optimizeOrder, routeCost, buildBookmarklet } = core;
const parseImport = value => JSON.parse(JSON.stringify(core.parseImport(value)));
const geocodeQueries = value => Array.from(core.geocodeQueries(value));

async function main() {

assert.deepEqual(geocodeQueries("PSG PERPETUO SOCORRO,185, Belém, Brasil"), [
  "Passagem PERPETUO SOCORRO, 185, Belém, Brasil",
  "PSG PERPETUO SOCORRO, 185, Belém, Brasil"
]);
assert.deepEqual(geocodeQueries("Av. Nazaré, 10, Belém"), ["Avenida Nazaré, 10, Belém", "Av. Nazaré, 10, Belém"]);
assert.deepEqual(geocodeQueries("QUATORZE DE MARÇO,1561, Belém, 66055-490, Brasil"), [
  "Travessa Quatorze de Março, 1561, Belém, 66055-490, Brasil",
  "QUATORZE DE MARÇO, 1561, Belém, 66055-490, Brasil"
]);

const warecloudsText = `
902959898
204548
Destinatário
NOME QUE NÃO DEVE SER IMPORTADO
Endereço
Rua de Exemplo, 2448
Município
Belém
Departamento/De/Bloco
CREMACAO
CEP
66040-036
Comentários
Entre duas ruas
Telefone do destinatário
91999999999
`;
const parsed = parseImport(warecloudsText);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].street, "Rua de Exemplo, 2448");
assert.equal(parsed[0].municipality, "Belém");
assert.equal(parsed[0].postalCode, "66040-036");
assert.equal(parsed[0].note, "Entre duas ruas");
assert.ok(!JSON.stringify(parsed).includes("NOME QUE NÃO DEVE SER IMPORTADO"));
assert.ok(!JSON.stringify(parsed).includes("91999999999"));

const colonLabels = parseImport("Endereço:\nAv. Exemplo, 10\nMunicípio:\nBelém");
assert.equal(colonLabels.length, 1);
assert.equal(colonLabels[0].street, "Av. Exemplo, 10");
assert.equal(colonLabels[0].municipality, "Belém");

const bookmarklet = buildBookmarklet("https://rota.example/");
const bookmarkTarget = { href: "" };
let detailsExpanded = false;
const importTextWithoutZip = warecloudsText.replace("CEP\n66040-036\n", "");
const moreInfoButton = { innerText: "Mais informações", click() { detailsExpanded = true; } };
const context = {
  document: {
    body: { get innerText() { return detailsExpanded ? importTextWithoutZip.replace("Comentários", "CEP\n66040-036\nComentários") : importTextWithoutZip; } },
    querySelectorAll: () => detailsExpanded ? [] : [moreInfoButton]
  },
  location: bookmarkTarget, alert() {}, btoa, unescape, encodeURIComponent, Date,
  setTimeout(callback) { callback(); }
};
await vm.runInNewContext(bookmarklet.slice("javascript:".length), context);
assert.ok(bookmarkTarget.href.startsWith("https://rota.example/#import="));
const packed = bookmarkTarget.href.split("#import=")[1];
const captured = JSON.parse(decodeURIComponent(Buffer.from(packed, "base64").toString("binary")));
assert.equal(captured.length, 1);
assert.equal(captured[0].street, "Rua de Exemplo, 2448");
assert.equal(captured[0].postalCode, "66040-036");
assert.ok(!JSON.stringify(captured).includes("NOME QUE NÃO DEVE SER IMPORTADO"));
assert.ok(!JSON.stringify(captured).includes("91999999999"));

const colonBookmarkTarget = { href: "" };
const colonBookmarkContext = { document: { body: { innerText: "Endereço:\nAv. Exemplo, 10\nMunicípio:\nBelém" }, querySelectorAll: () => [] }, location: colonBookmarkTarget, alert() {}, btoa, unescape, encodeURIComponent, Date, setTimeout(callback) { callback(); } };
await vm.runInNewContext(bookmarklet.slice("javascript:".length), colonBookmarkContext);
const colonCaptured = JSON.parse(decodeURIComponent(Buffer.from(colonBookmarkTarget.href.split("#import=")[1], "base64").toString("binary")));
assert.equal(colonCaptured.length, 1);
assert.equal(colonCaptured[0].street, "Av. Exemplo, 10");

const matrix = [
  [0, 7, 2, 9],
  [6, 0, 8, 2],
  [3, 2, 0, 6],
  [8, 2, 3, 0]
];
const order = optimizeOrder(matrix, false);
assert.deepEqual([...order].sort((a, b) => a - b), [1, 2, 3]);
assert.ok(routeCost(order, matrix, false) <= routeCost([1, 2, 3], matrix, false));
assert.equal(order.length, 3);
console.log("Core parser and route ordering checks passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; });

const alternateLabels = parseImport('Endereço de entrega:\nRua Exemplo, 10\nMunicípio de entrega:\nBelém');
assert.equal(alternateLabels.length, 1);
assert.equal(alternateLabels[0].municipality, 'Belém');
const noCrossOrder = parseImport('902111111\nEndereço\nRua A, 1\n902222222\nEndereço\nRua B, 2\nMunicípio\nBelém\nCEP\n66000-001');
assert.equal(noCrossOrder.length, 1);
assert.equal(noCrossOrder[0].street, 'Rua B, 2');
assert.equal(noCrossOrder[0].orderRef, 'Pedido 902222222');
const noCrossZip = parseImport('Endereço\nRua A, 1\nMunicípio\nBelém\nEndereço\nRua B, 2\nMunicípio\nBelém\nCEP\n66000-002');
assert.equal(noCrossZip[0].postalCode, '');
assert.equal(noCrossZip[1].postalCode, '66000-002');

const expectedStop = { street: 'Rua Exemplo, 10', municipality: 'Belém', postalCode: '66000-001' };
const cityPoint = { lat: '-1.45', lon: '-48.49', addresstype: 'road', name: 'Rua Exemplo', address: { road: 'Rua Exemplo', city: 'Belém', state: 'Pará', country_code: 'br', postcode: '66000-001', suburb: 'Centro' } };
const islandPoint = { ...cityPoint, lat: '-1.16', lon: '-48.45', display_name: 'Rua Exemplo, Mosqueiro, Belém, Pará', address: { ...cityPoint.address, postcode: '66910-000', suburb: 'Mosqueiro' } };
assert.equal(core.selectGeocodeResult([islandPoint, cityPoint], expectedStop), cityPoint);
assert.equal(core.selectGeocodeResult([islandPoint], expectedStop), null);
assert.equal(core.selectGeocodeResult([{ ...islandPoint, address: { ...islandPoint.address, postcode: undefined } }], expectedStop), null);
assert.equal(core.selectGeocodeResult([islandPoint], { ...expectedStop, postalCode: '66910-000' }), islandPoint);
assert.equal(core.selectGeocodeResult([{ ...cityPoint, addresstype: 'postcode' }], expectedStop), null);
assert.equal(core.selectGeocodeResult([{ ...cityPoint, address: { ...cityPoint.address, city: 'Belém', state: 'Paraíba' } }], expectedStop), null);
assert.equal(core.selectGeocodeResult([{ ...cityPoint, name: 'Rua Outra', address: { ...cityPoint.address, road: 'Rua Outra' } }], expectedStop), null);
assert.equal(core.selectGeocodeResult([cityPoint, { ...cityPoint, lat: '-1.20' }], expectedStop), null);
assert.equal(core.selectGeocodeResult([cityPoint], { ...expectedStop, block: 'Guamá' }), null);
assert.equal(core.selectGeocodeResult([cityPoint], { ...expectedStop, block: 'Belém' }), cityPoint);
assert.equal(geocodeQueries('RUA PSG TEIXEIRINHA,316, Belém, Brasil')[0], 'Passagem TEIXEIRINHA, 316, Belém, Brasil');
