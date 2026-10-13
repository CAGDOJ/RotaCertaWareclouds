(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RouteCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const clean = value => String(value || "").replace(/\s+/g, " ").trim();
  const plain = value => clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[:：]+$/u, "").trim();
  function geocodeQueries(address) {
    const original = clean(address).replace(/,(?=\S)/g, ", ");
    const expanded = original.replace(/^\s*rua\s+(psg|pass)\.?\s+/i, "Passagem ")
      .replace(/^\s*(psg|pass)\.?\s+/i, "Passagem ")
      .replace(/^\s*(tv|trv)\.?\s+/i, "Travessa ")
      .replace(/^\s*av\.?\s+/i, "Avenida ")
      .replace(/^\s*r\.?\s+/i, "Rua ")
      .replace(/^\s*al\.?\s+/i, "Alameda ")
      .replace(/^\s*rod\.?\s+/i, "Rodovia ");
    const normalized = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const normalizedAddress = normalized(original);
    const belémQuatorzeDeMarco = /\bbele[mn]\b/.test(normalizedAddress) && /^\s*(?:quatorze|14)\s+de\s+marco\b/i.test(normalizedAddress);
    const quatorzeVariant = belémQuatorzeDeMarco
      ? original.replace(/^\s*(?:quatorze|14)\s+de\s+mar[cç]o\b/i, "Travessa Quatorze de Março")
      : "";
    // A postcode-only result is an area centroid, not a delivery address.
    return [...new Set([quatorzeVariant, expanded, original].filter(Boolean))];
  }
  function selectGeocodeResult(results, expected) {
    const norm = value => plain(value).replace(/\b14 de (marco|abril)\b/g, "quatorze de $1");
    const digits = value => clean(value).replace(/\D/g, "");
    const city = norm(expected.municipality || "");
    const zip = digits(expected.postalCode || "");
    const requested = norm([expected.street, expected.block, expected.municipality].filter(Boolean).join(", "));
    const street = norm((expected.street || "").split(",")[0]).replace(/\b\d+\b/g, " ");
    const tokens = street.split(/[^a-z0-9]+/).filter(t => t.length > 1 && !["rua", "r", "psg", "pass", "passagem", "av", "avenida", "tv", "trv", "travessa", "al", "alameda", "rod", "rodovia", "de", "da", "do", "das", "dos"].includes(t));
    const block = norm(expected.block || "");
    const scored = [];
    for (const result of Array.isArray(results) ? results : []) {
      const lat = Number(result.lat), lon = Number(result.lon), a = result.address || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      const type = result.addresstype || result.type;
      if (["postcode", "city", "town", "village", "suburb", "neighbourhood", "administrative", "municipality", "county", "state", "country"].includes(type) || result.class === "boundary" || result.category === "boundary") continue;
      if (a.country_code && a.country_code !== "br") continue;
      const resultCities = [a.city, a.town, a.municipality, a.county, a.village].filter(Boolean).map(norm);
      if (city && !resultCities.includes(city)) continue;
      if (city === "belem" && a.state && norm(a.state) !== "para") continue;
      const actualZip = digits(a.postcode || "");
      const zipMatches = zip.length === 8 && actualZip === zip;
      if (zip.length === 8 && actualZip.length === 8 && !zipMatches) continue;
      const location = norm([result.display_name, a.suburb, a.city_district, a.village].filter(Boolean).join(", "));
      if (/\bmosqueiro\b/.test(location) && !/\bmosqueiro\b/.test(requested) && !zipMatches) continue;
      const road = norm(a.road || a.pedestrian || a.residential || result.name || "");
      if (tokens.length && !tokens.every(token => road.split(/[^a-z0-9]+/).includes(token))) continue;
      const neighborhoods = [a.suburb, a.neighbourhood, a.quarter, a.city_district].filter(Boolean).map(norm);
      const blockMatches = block && neighborhoods.some(value => value === block);
      if (block && block !== city && neighborhoods.length && !blockMatches) continue;
      scored.push({ result, score: (zipMatches ? 100 : 0) + (blockMatches ? 50 : 0) + (a.house_number ? 10 : 0) });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return null;
    const first = scored[0];
    // Equal evidence for distant points means the address still needs review.
    if (scored.slice(1).some(other => other.score === first.score && Math.hypot(Number(other.result.lat) - Number(first.result.lat), Number(other.result.lon) - Number(first.result.lon)) > 0.01)) return null;
    return first.result;
  }
  const fieldNames = {
    address: ["endereco", "endereco de entrega"], city: ["municipio", "municipio de entrega", "cidade", "cidade/uf"], block: ["departamento/de/bloco", "bairro", "complemento"],
    zip: ["cep"], note: ["comentarios", "comentario"]
  };
  const knownLabel = new Set(Object.values(fieldNames).flat());
  function readFollowing(lines, index, names, max = 8) {
    const wanted = new Set(names);
    for (let i = index + 1; i < Math.min(lines.length, index + max + 1); i++) {
      if (fieldNames.address.includes(plain(lines[i])) || /^\d{7,10}$/.test(lines[i])) break;
      if (wanted.has(plain(lines[i]))) return knownLabel.has(plain(lines[i + 1])) ? "" : clean(lines[i + 1] || "");
    }
    return "";
  }
  function readNote(lines, index, max = 16) {
    for (let i = index + 1; i < Math.min(lines.length, index + max + 1); i++) {
      if (fieldNames.address.includes(plain(lines[i])) || /^\d{7,10}$/.test(lines[i])) break;
      if (fieldNames.note.includes(plain(lines[i]))) {
        const parts = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
          const value = clean(lines[j]);
          if (!value || knownLabel.has(plain(value)) || /^(telefone|documento|rg)(?:\s|$)|^(loja|ultima atualizacao|correspondencia|pedido|destinatario)$/i.test(plain(value))) break;
          parts.push(value);
        }
        return clean(parts.join(" "));
      }
    }
    return "";
  }
  function parseLabeledText(text) {
    const lines = String(text || "").split(/\r?\n/).map(clean).filter(Boolean);
    const result = [];
    let currentRef = "";
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{7,10}$/.test(lines[i])) currentRef = lines[i];
      if (!fieldNames.address.includes(plain(lines[i]))) continue;
      const street = clean(lines[i + 1] || "");
      const city = readFollowing(lines, i, fieldNames.city);
      const block = readFollowing(lines, i, fieldNames.block);
      const zip = readFollowing(lines, i, fieldNames.zip);
      const note = readNote(lines, i);
      if (!street || !city || knownLabel.has(plain(street))) { currentRef = ""; continue; }
      const address = [street, block, city, zip, "Brasil"].filter(Boolean).join(", ");
      result.push({ id: cryptoId(), orderRef: currentRef ? `Pedido ${currentRef}` : `Parada ${result.length + 1}`, street, block, municipality: city, postalCode: zip, note, address, lat: null, lon: null, done: false });
      currentRef = "";
    }
    return result;
  }
  function parseCsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];
    const delimiter = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? "\t" : ((lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",");
    const split = line => {
      const cells = []; let current = ""; let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"' && line[i + 1] === '"' && quoted) { current += '"'; i++; }
        else if (ch === '"') quoted = !quoted;
        else if (ch === delimiter && !quoted) { cells.push(clean(current)); current = ""; }
        else current += ch;
      }
      cells.push(clean(current)); return cells;
    };
    const headers = split(lines[0]).map(plain);
    const find = aliases => headers.findIndex(header => aliases.includes(header));
    const addressIndex = find(["endereco", "address", "logradouro"]);
    if (addressIndex < 0) return [];
    const cityIndex = find(["municipio", "cidade", "city"]), zipIndex = find(["cep", "postalcode"]), blockIndex = find(["bairro", "complemento", "departamento/de/bloco"]), refIndex = find(["pedido", "codigo", "order", "orderid"]), noteIndex = find(["comentario", "observacao", "referencia"]);
    return lines.slice(1).map((line, row) => {
      const cells = split(line), street = cells[addressIndex] || "", city = cityIndex >= 0 ? cells[cityIndex] || "" : "";
      if (!street || !city) return null;
      const block = blockIndex >= 0 ? cells[blockIndex] || "" : "", zip = zipIndex >= 0 ? cells[zipIndex] || "" : "";
      return { id: cryptoId(), orderRef: refIndex >= 0 && cells[refIndex] ? `Pedido ${cells[refIndex]}` : `Parada ${row + 1}`, street, block, municipality: city, postalCode: zip, note: noteIndex >= 0 ? cells[noteIndex] || "" : "", address: [street, block, city, zip, "Brasil"].filter(Boolean).join(", "), lat: null, lon: null, done: false };
    }).filter(Boolean);
  }
  function parseImport(text) {
    const labeled = parseLabeledText(text);
    return labeled.length ? labeled : parseCsv(text);
  }
  function buildBookmarklet(target) {
    const code = `(async()=>{try{const n=s=>String(s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase().replace(/[:：]+$/u,"").trim();const pause=ms=>new Promise(r=>setTimeout(r,ms));for(let pass=0;pass<3;pass++){const more=[...document.querySelectorAll("button,[role=button],summary,a")].filter(e=>n(e.innerText||e.textContent||e.getAttribute("aria-label"))==="mais informacoes");if(!more.length)break;for(const e of more)e.click();await pause(400)}const l=(document.body.innerText||"").split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);const out=[];let ref="";for(let i=0;i<l.length;i++){if(/^\\d{7,10}$/.test(l[i]))ref=l[i];if(!["endereco","endereco de entrega"].includes(n(l[i])))continue;const val=(keys)=>{for(let j=i+1;j<Math.min(l.length,i+28);j++)if(keys.includes(n(l[j])))return (l[j+1]||"").trim();return ""};const street=(l[i+1]||"").trim(),city=val(["municipio","municipio de entrega","cidade","cidade/uf"]),block=val(["departamento/de/bloco","bairro","complemento"]),zip=val(["cep"]);let note="";for(let j=i+1;j<Math.min(l.length,i+28);j++)if(["comentario","comentarios"].includes(n(l[j]))){const a=[];for(let k=j+1;k<Math.min(l.length,j+4);k++){if(!l[k]||/^(telefone|documento|rg)(?:\\s|$)/.test(n(l[k]))||["loja","cep","endereco","endereco de entrega","municipio","municipio de entrega"].includes(n(l[k])))break;a.push(l[k].trim())}note=a.join(" ");break}if(street&&city){out.push({id:"wc-"+out.length+"-"+Date.now(),orderRef:ref?"Pedido "+ref:"Parada "+(out.length+1),street,block,municipality:city,postalCode:zip,note,address:[street,block,city,zip,"Brasil"].filter(Boolean).join(", ")});ref=""}}if(!out.length){alert("Não encontrei endereços nesta tela. Abra Pedidos > Entregar e tente o favorito novamente.");return}const payload=btoa(unescape(encodeURIComponent(JSON.stringify(out))));location.href=${JSON.stringify(target)}+"#import="+payload}catch(e){alert("Falha ao ler a lista. Tente copiar e colar o texto na Rota Certa.")}})()`;
    return `javascript:${code}`;
  }
  function cryptoId() {
    return (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  function routeCost(order, matrix, closed) {
    let total = 0, previous = 0;
    for (const point of order) {
      const value = matrix[previous] && matrix[previous][point];
      if (!Number.isFinite(value)) return Infinity;
      total += value; previous = point;
    }
    if (closed) {
      const back = matrix[previous] && matrix[previous][0];
      if (!Number.isFinite(back)) return Infinity;
      total += back;
    }
    return total;
  }
  function optimizeOrder(matrix, closed) {
    const count = matrix.length;
    if (count <= 1) return [];
    const remaining = new Set(Array.from({ length: count - 1 }, (_, i) => i + 1));
    const order = []; let current = 0;
    while (remaining.size) {
      let best = null, bestCost = Infinity;
      for (const candidate of remaining) {
        const cost = matrix[current] && matrix[current][candidate];
        if (Number.isFinite(cost) && cost < bestCost) { best = candidate; bestCost = cost; }
      }
      if (best === null) throw new Error("Há paradas sem ligação viária entre si. Confira os endereços.");
      order.push(best); remaining.delete(best); current = best;
    }
    let bestCost = routeCost(order, matrix, closed), improved = true, passes = 0;
    while (improved && passes < 8) {
      improved = false; passes++;
      for (let i = 0; i < order.length - 1; i++) {
        for (let j = i + 1; j < order.length; j++) {
          const candidate = order.slice();
          const reversed = candidate.slice(i, j + 1).reverse();
          candidate.splice(i, j - i + 1, ...reversed);
          const cost = routeCost(candidate, matrix, closed);
          if (cost + 0.5 < bestCost) { order.splice(0, order.length, ...candidate); bestCost = cost; improved = true; }
        }
      }
    }
    return order;
  }
  return { parseImport, parseLabeledText, parseCsv, optimizeOrder, routeCost, buildBookmarklet, plain, geocodeQueries, selectGeocodeResult };
});
