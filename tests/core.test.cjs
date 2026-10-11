const assert = require("node:assert/strict");
const vm = require("node:vm");
const { parseImport, optimizeOrder, routeCost, buildBookmarklet } = require("../dist/core.js");

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
const context = { document: { body: { innerText: warecloudsText } }, location: bookmarkTarget, alert() {}, btoa, unescape, encodeURIComponent, Date };
vm.runInNewContext(bookmarklet.slice("javascript:".length), context);
assert.ok(bookmarkTarget.href.startsWith("https://rota.example/#import="));
const packed = bookmarkTarget.href.split("#import=")[1];
const captured = JSON.parse(decodeURIComponent(Buffer.from(packed, "base64").toString("binary")));
assert.equal(captured.length, 1);
assert.equal(captured[0].street, "Rua de Exemplo, 2448");
assert.ok(!JSON.stringify(captured).includes("NOME QUE NÃO DEVE SER IMPORTADO"));
assert.ok(!JSON.stringify(captured).includes("91999999999"));

const colonBookmarkTarget = { href: "" };
const colonBookmarkContext = { document: { body: { innerText: "Endereço:\nAv. Exemplo, 10\nMunicípio:\nBelém" } }, location: colonBookmarkTarget, alert() {}, btoa, unescape, encodeURIComponent, Date };
vm.runInNewContext(bookmarklet.slice("javascript:".length), colonBookmarkContext);
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
