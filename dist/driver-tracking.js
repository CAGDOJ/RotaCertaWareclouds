(function () {
  'use strict';
  const API = 'https://rotacerta-mobile.carlosjralfa.chatgpt.site/api/tracking';
  const STORE = 'rotacerta.tracking.session.v1';
  const root = document.getElementById('customerTracking');
  if (!root) return;
  let current = [], route = null, session = null, position = null, watch = null, heartbeat = null;
  let live = false, sending = false, queued = false, nextSeconds = null, estimatedAt = 0, lastPublished = 0;
  try { session = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (_) {}
  if (session && session.expiresAt < Date.now()) { session = null; localStorage.removeItem(STORE); }
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const status = text => { document.getElementById('trackingStatus').textContent = text; };
  async function call(body) {
    const response = await fetch(API, {
      method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.ownerToken}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000)
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 410) {
        live = false; if (watch !== null) navigator.geolocation.clearWatch(watch);
        watch = null; clearInterval(heartbeat); session = null; localStorage.removeItem(STORE); render();
      }
      throw new Error(data.error || 'Não foi possível atualizar agora.');
    }
    return data;
  }
  function clientUrl(link) {
    return `https://cagdoj.github.io/RotaCertaWareclouds/acompanhar.html#r=${encodeURIComponent(session.routeId)}&t=${link.token}`;
  }
  function render() {
    const start = document.getElementById('startTracking');
    start.textContent = session ? (live ? 'Localização ativa' : 'Retomar localização') : 'Iniciar acompanhamento';
    start.disabled = live || !route;
    document.getElementById('stopTracking').hidden = !session;
    document.getElementById('customerLinks').innerHTML = session ? current.map(stop => {
      const link = session.links.find(l => l.id === stop.id);
      return link ? `<div class="tracking-link-row"><span><strong>${esc(stop.orderRef)}</strong><small>${stop.done ? 'Entregue' : 'Link individual do cliente'}</small></span><button class="button secondary small" type="button" data-tracking-link="${esc(stop.id)}">Compartilhar link</button></div>` : '';
    }).join('') : '';
  }
  function etas() {
    let seconds = 0, first = true; const values = {};
    current.forEach((stop, i) => {
      if (stop.done) return;
      const leg = first && Number.isFinite(nextSeconds) ? nextSeconds : Number(route?.durations?.[i] || (route?.duration || 0) / Math.max(1, current.length));
      seconds += leg + (first ? 0 : 180); first = false;
      values[stop.id] = Date.now() + Math.max(60, seconds) * 1000;
    });
    return values;
  }
  async function estimateNext() {
    const next = current.find(s => !s.done);
    if (!position || !next || Date.now() - estimatedAt < 60000) return;
    estimatedAt = Date.now();
    try {
      const coords = `${position.lon},${position.lat};${next.lon},${next.lat}`;
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=false&steps=false`, { signal: AbortSignal.timeout(12000) });
      const data = await r.json();
      if (data.code === 'Ok' && Number.isFinite(data.routes?.[0]?.duration)) nextSeconds = data.routes[0].duration;
    } catch (_) { /* The route estimate remains available when the map service is offline. */ }
  }
  async function publish() {
    if (!session || !live) return;
    if (sending) { queued = true; return; }
    sending = true;
    try {
      do {
        queued = false;
        if (position && Date.now() - position.observedAt >= 60000) position = null;
        const active = session;
        await call({ action: 'update', routeId: active.routeId, orderIds: current.map(s => s.id), doneIds: current.filter(s => s.done).map(s => s.id), etas: etas(), position });
        lastPublished = Date.now();
        if (session === active) status(position ? 'Localização enviada. Mantenha esta página aberta no celular durante o trajeto.' : 'Aguardando a localização do celular…');
      } while (queued && session && live);
    } catch (error) { status(error.message + ' A conexão será tentada novamente.'); }
    finally { sending = false; }
  }
  function startGps() {
    if (!navigator.geolocation) { status('Este navegador não permite compartilhar a localização. Abra no celular.'); return; }
    live = true; render();
    watch = navigator.geolocation.watchPosition(async p => {
      position = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, observedAt: p.timestamp || Date.now() };
      await estimateNext(); if (Date.now() - lastPublished >= 15000) await publish();
    }, error => {
      position = null;
      status(error.code === 1 ? 'Permita o acesso à localização nas configurações do navegador. Nenhuma posição está sendo enviada.' : 'Sem sinal de localização. Confira GPS e internet do celular.');
      publish();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    heartbeat = setInterval(() => { estimateNext(); publish(); }, 15000);
    status('Permita a localização para iniciar o acompanhamento.');
    publish();
  }
  async function start() {
    if (!route || !current.some(s => !s.done)) { status('Otimize uma rota com entregas pendentes antes de começar.'); return; }
    document.getElementById('startTracking').disabled = true;
    try {
      if (!session) {
        status('Preparando os links individuais…');
        session = await call({ action: 'start', stops: current.map(s => ({ id: s.id, orderRef: s.orderRef, street: s.street, municipality: s.municipality, lat: s.lat, lon: s.lon, done: s.done })) });
        localStorage.setItem(STORE, JSON.stringify(session));
      }
      startGps();
    } catch (error) { status(error.message); }
    finally { render(); }
  }
  async function stop() {
    live = false;
    if (watch !== null) navigator.geolocation.clearWatch(watch);
    watch = null; clearInterval(heartbeat); heartbeat = null; position = null;
    if (session) {
      try { await call({ action: 'stop', routeId: session.routeId }); }
      catch (error) { status('Não consegui encerrar no servidor. Tente novamente; a localização deixa de aparecer após um minuto sem sinal.'); render(); return; }
    }
    session = null; localStorage.removeItem(STORE); render(); status('Acompanhamento encerrado. Os links antigos não exibem sua localização.');
  }
  root.addEventListener('click', async event => {
    if (event.target.closest('#startTracking')) return start();
    if (event.target.closest('#stopTracking')) return stop();
    const button = event.target.closest('[data-tracking-link]');
    if (!button || !session) return;
    const link = session.links.find(l => l.id === button.dataset.trackingLink);
    const delivery = current.find(s => s.id === button.dataset.trackingLink);
    if (!link || !delivery) return;
    const url = clientUrl(link), text = `Acompanhe sua entrega ${delivery.orderRef} pelo Rota Certa:`;
    try {
      if (navigator.share) await navigator.share({ title: 'Acompanhe sua entrega', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); status('Link copiado. Envie ao cliente pelo WhatsApp.'); }
    } catch (error) { if (error.name !== 'AbortError') status('Não consegui compartilhar. Tente novamente pelo botão do pedido.'); }
  });
  window.RouteTracking = {
    async clear() {
      await stop(); session = null; localStorage.removeItem(STORE); render();
    },
    sync(stops, selectedRoute) {
      const changed = JSON.stringify(current.map(s => [s.id, s.done])) !== JSON.stringify(stops.map(s => [s.id, s.done]));
      current = stops.map(s => ({ ...s })); route = selectedRoute;
      if (session && (!route || current.length !== session.links.length || current.some(s => !session.links.some(l => l.id === s.id)))) { stop(); return; }
      if (changed) { estimatedAt = 0; nextSeconds = null; if (live) publish(); }
      render();
    }
  };
  render();
})();
