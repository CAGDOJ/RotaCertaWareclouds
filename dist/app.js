(function () {
  "use strict";
  const CORE = window.RouteCore;
  const STORE_KEY = "rotacerta.mobile.state.v1";
  const CACHE_KEY = "rotacerta.geocode.cache.v1";
  const WARECLOUDS_URL = "https://b2c-clouder-br-prod.web.app/orders/dashboard";
  const OSRM = "https://router.project-osrm.org";
  const NOMINATIM = "https://nominatim.openstreetmap.org/search";
  const $ = id => document.getElementById(id);
  const state = {
    stops: [], orderIds: [], route: null, origin: null, originLabel: "", originMode: "gps",
    source: "", lastRequestAt: 0, busy: false
  };
  let map = null, tileLayer = null, routeLayers = [];
  const els = {
    pasteBox: $("pasteBox"), importStatus: $("importStatus"), routeStatus: $("routeStatus"),
    startAddress: $("startAddress"), cityFilter: $("cityFilter"), resultCityFilter: $("resultCityFilter"),
    shareConsent: $("shareConsent"), progressWrap: $("progressWrap"), progressBar: $("progressBar"),
    routeList: $("routeList"), toast: $("toast")
  };

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function showMessage(message) {
    els.toast.textContent = message; els.toast.classList.add("show");
    clearTimeout(showMessage.timer); showMessage.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }
  function status(element, message, type = "") {
    element.textContent = message; element.className = `status${type ? ` ${type}` : ""}`;
  }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && Array.isArray(saved.stops)) {
        state.stops = saved.stops.map(normalizeStop).filter(stop => stop.address);
        state.orderIds = Array.isArray(saved.orderIds) ? saved.orderIds : [];
        state.route = saved.route || null;
        state.origin = saved.origin || null;
        state.originLabel = saved.originLabel || "";
        state.originMode = saved.originMode || "gps";
      }
    } catch (_) { localStorage.removeItem(STORE_KEY); }
  }
  function normalizeStop(stop, index = 0) {
    const street = String(stop.street || stop.address || "").trim();
    const city = String(stop.municipality || stop.city || "").trim();
    const block = String(stop.block || stop.neighborhood || "").trim();
    const zip = String(stop.postalCode || stop.zip || stop.cep || "").trim();
    return {
      id: String(stop.id || `stop-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`),
      orderRef: String(stop.orderRef || stop.code || `Parada ${index + 1}`).slice(0, 50),
      street, block, municipality: city, postalCode: zip, note: String(stop.note || "").slice(0, 240),
      address: String(stop.address || [street, block, city, zip, "Brasil"].filter(Boolean).join(", ")).trim(),
      lat: Number.isFinite(Number(stop.lat)) && stop.lat !== null ? Number(stop.lat) : null,
      lon: Number.isFinite(Number(stop.lon)) && stop.lon !== null ? Number(stop.lon) : null,
      done: Boolean(stop.done)
    };
  }
  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ stops: state.stops, orderIds: state.orderIds, route: state.route, origin: state.origin, originLabel: state.originLabel, originMode: state.originMode }));
    } catch (_) { showMessage("Não foi possível salvar: o armazenamento do navegador está cheio."); }
  }
  function setBusy(busy) {
    state.busy = busy;
    [$("optimizeButton"), $("reoptimizeButton"), $("parsePaste"), $("clearRoute")].forEach(button => { if (button) button.disabled = busy; });
  }
  function progress(value, visible = true) {
    els.progressWrap.hidden = !visible;
    els.progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
  }
  function uniqueCities() { return [...new Set(state.stops.map(stop => stop.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")); }
  function selectedStops() {
    const city = els.cityFilter.value;
    return state.stops.filter(stop => !city || stop.municipality === city);
  }
  function orderedStops() {
    const byId = new Map(state.stops.map(stop => [stop.id, stop]));
    const ordered = state.orderIds.map(id => byId.get(id)).filter(Boolean);
    const seen = new Set(ordered.map(stop => stop.id));
    return ordered.length ? [...ordered, ...state.stops.filter(stop => !seen.has(stop.id))] : state.stops;
  }
  function routedStops() {
    if (!state.route) return orderedStops();
    const byId = new Map(state.stops.map(stop => [stop.id, stop]));
    return state.orderIds.map(id => byId.get(id)).filter(Boolean);
  }
  function drawCitySelectors() {
    const cities = uniqueCities();
    const selected = els.cityFilter.value, resultSelected = els.resultCityFilter.value;
    els.cityFilter.innerHTML = `<option value="">Todos os municípios</option>${cities.map(city => `<option value="${escapeHTML(city)}">${escapeHTML(city)}</option>`).join("")}`;
    els.resultCityFilter.innerHTML = `<option value="">Todas as paradas</option>${cities.map(city => `<option value="${escapeHTML(city)}">${escapeHTML(city)}</option>`).join("")}`;
    if (cities.includes(selected)) els.cityFilter.value = selected;
    if (cities.includes(resultSelected)) els.resultCityFilter.value = resultSelected;
  }
  function renderStopCards(container, stops, ordered = false, preview = false) {
    if (!stops.length) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">📦</div><strong>Nenhuma entrega para mostrar</strong>Importe suas paradas da Wareclouds para começar.</div>`;
      return;
    }
    const allOrdered = orderedStops();
    const rank = new Map(allOrdered.map((stop, i) => [stop.id, i]));
    container.innerHTML = stops.map((stop, index) => {
      const position = ordered ? rank.get(stop.id) ?? index : index;
      const previous = allOrdered[position - 1], next = allOrdered[position + 1];
      const address = [stop.street, stop.block, stop.municipality, stop.postalCode].filter(Boolean).join(", ");
      return `<article class="stop${stop.done ? " done" : ""}" data-stop="${escapeHTML(stop.id)}">
        <div class="stop-index">${ordered ? position + 1 : "•"}</div>
        <div class="stop-main"><div class="stop-head"><div><div class="stop-title">${escapeHTML(stop.orderRef)}</div><div class="stop-order">${escapeHTML(stop.municipality || "Município não informado")}</div></div>
          ${preview ? "" : `<div class="stop-tools"><button class="move-button" data-move="up" data-id="${escapeHTML(stop.id)}" aria-label="Mover para cima" ${position <= 0 ? "disabled" : ""}>↑</button><button class="move-button" data-move="down" data-id="${escapeHTML(stop.id)}" aria-label="Mover para baixo" ${position >= allOrdered.length - 1 ? "disabled" : ""}>↓</button></div>`}</div>
          <div class="stop-address">${escapeHTML(address)}</div>${stop.note ? `<div class="stop-note">Referência: ${escapeHTML(stop.note)}</div>` : ""}
          <div class="stop-actions">${preview ? `<button class="button danger small" data-remove="${escapeHTML(stop.id)}" type="button">Remover</button>` : `<label class="button ghost small"><input class="check-stop" type="checkbox" data-done="${escapeHTML(stop.id)}" ${stop.done ? "checked" : ""}>Concluída nesta lista</label>${Number.isFinite(stop.lat) && Number.isFinite(stop.lon) ? `<a class="button secondary small" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${stop.lat},${stop.lon}`)}&travelmode=driving" target="_blank" rel="noopener">Navegar ↗</a>` : ""}`}<button class="button ghost small" data-edit="${escapeHTML(stop.id)}" type="button">Editar</button></div>
        </div></article>`;
    }).join("");
  }
  function refresh() {
    drawCitySelectors();
    const stops = selectedStops();
    const cities = uniqueCities();
    $("heroStopCount").textContent = String(state.stops.length);
    $("heroCity").textContent = cities.length === 1 ? cities[0] : cities.length > 1 ? `${cities.length} municípios` : "Aguardando sua rota";
    $("routeCountLabel").textContent = stops.length ? `${stops.length} ${stops.length === 1 ? "parada selecionada" : "paradas selecionadas"}` : "Nenhuma parada carregada";
    renderStopCards(els.routeList, routedStops().filter(stop => !els.resultCityFilter.value || stop.municipality === els.resultCityFilter.value), true);
    $("importedPreview").hidden = !state.stops.length || Boolean(state.route);
    $("previewCount").textContent = stops.length ? `${stops.length} ${stops.length === 1 ? "parada" : "paradas"}` : "";
    renderStopCards($("previewList"), stops, false, true);
    $("emptyRoute").hidden = Boolean(state.route);
    $("routeView").hidden = !state.route;
    if (state.route) {
      $("distanceMetric").textContent = `${(state.route.distance / 1000).toFixed(1).replace(".", ",")}`;
      const mins = Math.round(state.route.duration / 60);
      $("timeMetric").textContent = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}`;
      $("stopMetric").textContent = String(state.route.stopCount || state.orderIds.length);
      renderMap(); updateNextNavigation();
    }
    persist();
  }
  function baseForBookmark() { return `${location.origin}${location.pathname}`; }
  function createBookmarklet() {
    return CORE.buildBookmarklet(baseForBookmark());
  }
  async function copyBookmarklet() {
    const code = createBookmarklet();
    $("bookmarkletPreview").textContent = code;
    try {
      await navigator.clipboard.writeText(code); showMessage("Importador copiado. Agora salve como favorito no Safari.");
      status(els.importStatus, "Atalho de captura copiado. Siga as instruções em ‘Configurar captura rápida’. ", "good");
    } catch (_) {
      status(els.importStatus, "O navegador bloqueou a cópia. Selecione e copie o código exibido nas instruções.", "error");
    }
  }
  function decodePayload(payload) {
    const binary = atob(payload); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  function consumeImportHash() {
    const hash = location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const payload = params.get("import");
    if (!payload) return;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      const received = JSON.parse(decodePayload(payload));
      if (!Array.isArray(received)) throw new Error("Formato inesperado");
      const stops = received.map(normalizeStop).filter(stop => stop.street && stop.municipality);
      if (!stops.length) throw new Error("Nenhum endereço encontrado");
      state.stops = stops; state.orderIds = stops.map(stop => stop.id); state.route = null; state.source = "bookmarklet";
      status(els.importStatus, `${stops.length} ${stops.length === 1 ? "parada importada" : "paradas importadas"}. Revise município e endereço antes de otimizar.`, "good");
      $("pasteBox").value = ""; refresh(); showMessage("Entregas importadas. Confira os endereços.");
      document.getElementById("screen-route").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      status(els.importStatus, `Não consegui ler a captura (${error.message}). Tente a importação por texto.`, "error");
    }
  }
  function parsePaste() {
    const value = els.pasteBox.value.trim();
    if (!value) { status(els.importStatus, "Cole primeiro o texto ou o CSV da lista.", "error"); return; }
    const stops = CORE.parseImport(value).map(normalizeStop).filter(stop => stop.street && stop.municipality);
    if (!stops.length) {
      status(els.importStatus, "Não encontrei pares de Endereço e Município. Cole o texto da tela de entregas ou um CSV com colunas endereço e município.", "error"); return;
    }
    state.stops = stops; state.orderIds = stops.map(stop => stop.id); state.route = null; state.source = "paste";
    status(els.importStatus, `${stops.length} ${stops.length === 1 ? "parada lida" : "paradas lidas"}. Confira os dados antes de seguir.`, "good");
    refresh(); showMessage("Lista carregada neste aparelho.");
    document.getElementById("screen-route").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function pasteClipboard() {
    try { els.pasteBox.value = await navigator.clipboard.readText(); if (els.pasteBox.value) parsePaste(); else showMessage("A área de transferência está vazia."); }
    catch (_) { els.pasteBox.focus(); showMessage("Toque no campo e escolha Colar no menu do celular."); }
  }
  function loadGeocodeCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (_) { return {}; } }
  function saveGeocodeCache(cache) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) {} }
  const geocodeCache = loadGeocodeCache();
  function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function geocode(address, progressMessage) {
    const key = address.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
    if (geocodeCache[key]) return geocodeCache[key];
    let result = null;
    for (const query of CORE.geocodeQueries(address)) {
      const elapsed = Date.now() - state.lastRequestAt;
      if (state.lastRequestAt && elapsed < 1100) await wait(1100 - elapsed);
      state.lastRequestAt = Date.now();
      const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
      if (response.status === 429) throw new Error("O mapa limitou as consultas. Aguarde um minuto e tente novamente.");
      if (!response.ok) throw new Error(`O mapa respondeu com erro ${response.status}.`);
      const results = await response.json();
      if (results.length) { result = results[0]; break; }
    }
    if (!result) throw new Error(`Não encontrei “${address}”. Confira o tipo da via, CEP ou município; abreviações como “PSG” são pesquisadas como “Passagem”.`);
    const point = { lat: Number(result.lat), lon: Number(result.lon), display: result.display_name };
    geocodeCache[key] = point; saveGeocodeCache(geocodeCache);
    if (progressMessage) progressMessage();
    return point;
  }
  function getDeviceLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("Este navegador não disponibiliza localização. Digite o ponto de partida."));
      navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }), error => {
        const messages = { 1: "Permita a localização no navegador ou informe um endereço de partida.", 2: "Não consegui obter sua localização. Digite o ponto de partida.", 3: "A localização demorou demais. Tente de novo ou informe um endereço." };
        reject(new Error(messages[error.code] || "Não consegui obter sua localização."));
      }, { enableHighAccuracy: true, timeout: 16000, maximumAge: 60000 });
    });
  }
  async function setDeviceOrigin() {
    status(els.routeStatus, "Aguardando a localização do celular…");
    try {
      const point = await getDeviceLocation(); state.origin = point; state.originMode = "gps"; state.originLabel = "Localização atual";
      els.startAddress.value = "Localização atual deste aparelho"; status(els.routeStatus, "Ponto de partida definido pelo celular.", "good");
    } catch (error) { state.origin = null; status(els.routeStatus, error.message, "error"); }
  }
  async function buildMatrix(points) {
    const coords = points.map(point => `${point.lon},${point.lat}`).join(";");
    const response = await fetch(`${OSRM}/table/v1/driving/${coords}?annotations=duration,distance`);
    if (!response.ok) throw new Error(`O serviço de rotas respondeu com erro ${response.status}.`);
    const result = await response.json();
    if (result.code !== "Ok" || !result.durations) throw new Error("O serviço de rotas não conseguiu conectar todas as paradas.");
    return result.durations;
  }
  async function fetchRoadRoute(points) {
    const coords = points.map(point => `${point.lon},${point.lat}`).join(";");
    const response = await fetch(`${OSRM}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`);
    if (!response.ok) throw new Error(`Não consegui traçar as ruas (${response.status}).`);
    const result = await response.json();
    if (result.code !== "Ok" || !result.routes || !result.routes[0]) throw new Error("Não consegui desenhar essa sequência pela malha viária.");
    return result.routes[0];
  }
  async function optimize() {
    if (state.busy) return;
    if (!state.stops.length) { status(els.routeStatus, "Importe as entregas antes de otimizar.", "error"); return; }
    if (!els.shareConsent.checked) { status(els.routeStatus, "Marque a autorização de mapa para enviar os endereços ao serviço de rota.", "error"); return; }
    const stops = selectedStops();
    if (!stops.length) { status(els.routeStatus, "Não há paradas nesse município.", "error"); return; }
    setBusy(true); progress(1, true); status(els.routeStatus, "Preparando a rota…");
    try {
      let origin = state.origin;
      const manual = els.startAddress.value.trim();
      if (manual && state.originMode !== "gps") {
        status(els.routeStatus, "Localizando o ponto de partida…");
        origin = await geocode(`${manual}, Brasil`);
      } else if (!origin) {
        if (manual && !/^localizacao atual/i.test(manual)) {
          state.originMode = "manual"; status(els.routeStatus, "Localizando o ponto de partida…"); origin = await geocode(`${manual}, Brasil`);
        } else {
          status(els.routeStatus, "Localizando seu celular…"); origin = await getDeviceLocation(); state.originLabel = "Localização atual";
        }
      }
      if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon)) throw new Error("Defina um ponto de partida válido.");
      const unique = [...new Map(stops.map(stop => [stop.id, stop])).values()];
      for (let i = 0; i < unique.length; i++) {
        const stop = unique[i];
        if (Number.isFinite(stop.lat) && Number.isFinite(stop.lon)) continue;
        status(els.routeStatus, `Localizando parada ${i + 1} de ${unique.length}. Pode levar alguns segundos por endereço.`);
        const point = await geocode(stop.address);
        stop.lat = point.lat; stop.lon = point.lon;
        progress(5 + ((i + 1) / unique.length) * 45, true); persist();
      }
      status(els.routeStatus, "Calculando a sequência pelas vias…");
      const points = [origin, ...unique.map(stop => ({ lat: stop.lat, lon: stop.lon }))];
      const matrix = await buildMatrix(points);
      const closed = $("returnToStart").checked;
      const indices = CORE.optimizeOrder(matrix, closed);
      const ordered = indices.map(index => unique[index - 1]);
      const roadPoints = [origin, ...ordered.map(stop => ({ lat: stop.lat, lon: stop.lon }))];
      if (closed) roadPoints.push(origin);
      status(els.routeStatus, "Traçando a rota no mapa…"); progress(74, true);
      const route = await fetchRoadRoute(roadPoints);
      state.origin = origin; state.originMode = manual && state.originMode !== "gps" ? "manual" : state.originMode; state.originLabel = state.originLabel || (manual ? manual : "Localização atual");
      state.orderIds = ordered.map(stop => stop.id);
      state.route = { distance: route.distance, duration: route.duration, stopCount: ordered.length, geometry: route.geometry, municipality: els.cityFilter.value || "" };
      progress(100, true); status(els.routeStatus, `Rota pronta: ${ordered.length} paradas organizadas. Confira o primeiro endereço no mapa.`, "good");
      refresh();
      document.getElementById("screen-results").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => progress(0, false), 500);
    } catch (error) {
      status(els.routeStatus, error && error.message ? error.message : "Não consegui calcular a rota. Confira a conexão e os endereços.", "error");
      progress(0, false);
    } finally { setBusy(false); }
  }
  function ensureMap() {
    if (map || !window.L) return map;
    map = L.map("map", { zoomControl: false, scrollWheelZoom: false }).setView([-1.4558, -48.4902], 12);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    return map;
  }
  function renderMap() {
    if (!state.route || !state.route.geometry) return;
    if (!window.L) {
      $("map").innerHTML = `<div class="map-placeholder">O mapa não carregou neste momento. Use os botões de navegação para abrir cada endereço no Maps.</div>`;
      return;
    }
    const leafletMap = ensureMap(); if (!leafletMap) return;
    routeLayers.forEach(layer => leafletMap.removeLayer(layer)); routeLayers = [];
    const line = L.geoJSON(state.route.geometry, { style: { color: "#1556c0", weight: 5, opacity: .86, lineCap: "round", lineJoin: "round" } }).addTo(leafletMap);
    routeLayers.push(line);
    const origin = state.origin;
    if (origin) {
      const marker = L.marker([origin.lat, origin.lon], { icon: L.divIcon({ className: "route-number origin", html: "S", iconSize: [29, 29], iconAnchor: [14, 14] }) }).bindPopup(`<strong>Saída</strong><br>${escapeHTML(state.originLabel || "Ponto inicial")}`).addTo(leafletMap);
      routeLayers.push(marker);
    }
    routedStops().forEach((stop, index) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
      const marker = L.marker([stop.lat, stop.lon], { icon: L.divIcon({ className: "route-number", html: String(index + 1), iconSize: [29, 29], iconAnchor: [14, 14] }) }).bindPopup(`<strong>${index + 1}. ${escapeHTML(stop.orderRef)}</strong><br>${escapeHTML([stop.street, stop.municipality].filter(Boolean).join(", "))}`).addTo(leafletMap);
      routeLayers.push(marker);
    });
    const bounds = line.getBounds(); if (bounds.isValid()) leafletMap.fitBounds(bounds.pad(.14), { maxZoom: 15 });
    setTimeout(() => leafletMap.invalidateSize(), 100);
  }
  function updateNextNavigation() {
    const next = routedStops().find(stop => !stop.done && Number.isFinite(stop.lat) && Number.isFinite(stop.lon));
    const link = $("nextNav");
    if (!next) { link.href = "#"; link.textContent = "✓ Todas as paradas foram marcadas"; link.setAttribute("aria-disabled", "true"); return; }
    link.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${next.lat},${next.lon}`)}&travelmode=driving`;
    link.textContent = `↗ Navegar até ${next.orderRef}`; link.removeAttribute("aria-disabled");
  }
  function invalidateRoute() {
    state.route = null; refresh();
    status(els.routeStatus, "A rota mudou. Otimize novamente para calcular distância e mapa.");
  }
  function moveStop(id, direction) {
    const ordered = orderedStops(); const index = ordered.findIndex(stop => stop.id === id); const next = index + (direction === "up" ? -1 : 1);
    if (index < 0 || next < 0 || next >= ordered.length) return;
    [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
    state.orderIds = ordered.map(stop => stop.id); invalidateRoute();
  }
  function editStop(id) {
    const stop = state.stops.find(item => item.id === id); if (!stop) return;
    const address = prompt("Edite o endereço para localizar a parada:", stop.street);
    if (address === null) return;
    const city = prompt("Município:", stop.municipality);
    if (city === null) return;
    const zip = prompt("CEP (opcional):", stop.postalCode || "");
    if (zip === null) return;
    stop.street = address.trim(); stop.municipality = city.trim(); stop.postalCode = zip.trim();
    stop.address = [stop.street, stop.block, stop.municipality, stop.postalCode, "Brasil"].filter(Boolean).join(", "); stop.lat = null; stop.lon = null;
    invalidateRoute(); status(els.importStatus, "Endereço atualizado neste aparelho.", "good");
  }
  function deleteLocalData() {
    if (!confirm("Apagar as entregas, a rota e o cache deste aparelho?")) return;
    localStorage.removeItem(STORE_KEY); localStorage.removeItem(CACHE_KEY);
    state.stops = []; state.orderIds = []; state.route = null; state.origin = null; state.originLabel = ""; state.originMode = "gps";
    els.startAddress.value = ""; els.pasteBox.value = ""; els.shareConsent.checked = false;
    status($("settingsStatus"), "Dados locais apagados.", "good"); status(els.importStatus, ""); status(els.routeStatus, ""); refresh(); showMessage("Dados apagados deste aparelho.");
  }
  function initTabs() {
    document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(item => item.classList.toggle("active", item === tab));
      const target = $(tab.dataset.screen); if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (map) setTimeout(() => map.invalidateSize(), 250);
    }));
  }
  function attachEvents() {
    function startWarecloudsImport() {
      $("captureHelp").open = true;
      status(els.importStatus, "Wareclouds aberta. Entre na sua conta e toque no favorito “Rota Certa” para trazer os endereços para cá.", "good");
    }
    $("openWareclouds").addEventListener("click", startWarecloudsImport);
    $("openWarecloudsTop").addEventListener("click", () => { startWarecloudsImport(); window.open(WARECLOUDS_URL, "_blank", "noopener"); });
    $("helpButton").addEventListener("click", () => { $("captureHelp").open = true; $("captureHelp").scrollIntoView({ behavior: "smooth", block: "center" }); });
    $("copyBookmarklet").addEventListener("click", copyBookmarklet);
    $("parsePaste").addEventListener("click", parsePaste); $("pasteClipboard").addEventListener("click", pasteClipboard);
    $("useLocation").addEventListener("click", setDeviceOrigin);
    els.startAddress.addEventListener("input", () => { if (els.startAddress.value.trim() && els.startAddress.value !== "Localização atual deste aparelho") { state.origin = null; state.originMode = "manual"; state.originLabel = els.startAddress.value.trim(); } });
    $("optimizeButton").addEventListener("click", optimize); $("reoptimizeButton").addEventListener("click", optimize);
    $("clearRoute").addEventListener("click", () => { if (!confirm("Remover as paradas e a rota salvas neste aparelho?")) return; state.stops = []; state.orderIds = []; state.route = null; refresh(); status(els.importStatus, "Lista removida deste aparelho.", "good"); });
    $("deleteLocalData").addEventListener("click", deleteLocalData);
    els.cityFilter.addEventListener("change", () => { refresh(); });
    els.resultCityFilter.addEventListener("change", () => { renderStopCards(els.routeList, routedStops().filter(stop => !els.resultCityFilter.value || stop.municipality === els.resultCityFilter.value), true); });
    els.routeList.addEventListener("click", event => {
      const move = event.target.closest("[data-move]"); if (move) moveStop(move.dataset.id, move.dataset.move);
      const edit = event.target.closest("[data-edit]"); if (edit) editStop(edit.dataset.edit);
    });
    $("previewList").addEventListener("click", event => {
      const edit = event.target.closest("[data-edit]"); if (edit) editStop(edit.dataset.edit);
      const remove = event.target.closest("[data-remove]"); if (remove) { state.stops = state.stops.filter(stop => stop.id !== remove.dataset.remove); state.orderIds = state.orderIds.filter(id => id !== remove.dataset.remove); invalidateRoute(); status(els.importStatus, "Parada removida neste aparelho.", "good"); }
    });
    els.routeList.addEventListener("change", event => {
      const checkbox = event.target.closest("[data-done]"); if (!checkbox) return;
      const stop = state.stops.find(item => item.id === checkbox.dataset.done); if (stop) { stop.done = checkbox.checked; refresh(); }
    });
    initTabs();
  }
  function registerServiceWorker() {
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  loadState(); attachEvents(); consumeImportHash(); refresh(); registerServiceWorker();
})();
