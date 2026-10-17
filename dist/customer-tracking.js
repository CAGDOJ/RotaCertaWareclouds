(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  const routeId = params.get('r'), token = params.get('t');
  const demo = new URLSearchParams(location.search).get('demo') === '1';
  const truck = '<svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M3 6h11v11H3zm11 4h4l3 4v3h-7" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="18" r="2" fill="#1556c0" stroke="currentColor"/><circle cx="18" cy="18" r="2" fill="#1556c0" stroke="currentColor"/></svg>';
  let map, destinationMarker, driverMarker, accuracyCircle, lastData = null, timer, inFlight = false;
  function notice(message) { $('trackingNotice').textContent = message; $('trackingNotice').style.display = message ? 'block' : 'none'; }
  function fit() {
    if (!map || !lastData?.destination) return;
    const points = [[lastData.destination.lat, lastData.destination.lon]];
    if (lastData.position && Date.now() - lastData.updatedAt < 60000) points.push([lastData.position.lat, lastData.position.lon]);
    if (points.length > 1) map.fitBounds(points, { padding: [65, 100], maxZoom: 16 });
    else map.setView(points[0], 15);
  }
  function draw(data) {
    if (!window.L || !data.destination) { $('customerMap').innerHTML = '<div class="map-fallback">O mapa está indisponível agora. As informações da entrega continuam abaixo.</div>'; return; }
    if (!map) {
      $('customerMap').innerHTML = '';
      map = L.map('customerMap', { zoomControl: false, scrollWheelZoom: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    }
    if (!destinationMarker) destinationMarker = L.marker([data.destination.lat, data.destination.lon], { icon: L.divIcon({ className: 'destination-marker', html: '<div class="destination-pin"></div>', iconSize: [34, 44], iconAnchor: [17, 40] }) }).bindPopup('Sua entrega').addTo(map);
    if (data.position) {
      const p = [data.position.lat, data.position.lon];
      if (!driverMarker) { driverMarker = L.marker(p, { icon: L.divIcon({ className: 'driver-marker', html: truck, iconSize: [48, 48], iconAnchor: [24, 24] }) }).bindPopup('Entregador').addTo(map); fit(); }
      else driverMarker.setLatLng(p);
      if (accuracyCircle) map.removeLayer(accuracyCircle);
      accuracyCircle = L.circle(p, { radius: Math.min(Math.max(data.position.accuracy || 30, 20), 1000), color: '#1556c0', weight: 1, fillOpacity: .12 }).addTo(map);
    } else {
      if (driverMarker) map.removeLayer(driverMarker);
      if (accuracyCircle) map.removeLayer(accuracyCircle);
      driverMarker = null; accuracyCircle = null;
    }
    if (!draw.started) { draw.started = true; fit(); }
  }
  function render(data) {
    const stale = data.position && (!data.updatedAt || Date.now() - data.updatedAt >= 60000);
    if (stale) data = { ...data, position: null, status: data.status === 'nearby' ? 'next' : data.status };
    lastData = data;
    const labels = {
      waiting: ['Em rota', 'Começamos o percurso!', 'Estamos fazendo outras entregas antes da sua.', '40%'],
      next: ['Você é o próximo', 'Estamos indo até você.', 'Sua entrega é a próxima. Prepare-se para receber!', '70%'],
      nearby: ['Estamos chegando', 'Sua entrega está pertinho!', 'O entregador está próximo do seu destino.', '85%'],
      delivered: ['Entregue', 'Entrega concluída!', 'O entregador marcou esta parada como concluída. Obrigado por acompanhar.', '100%'],
      ended: ['Acompanhamento encerrado', 'Este trajeto foi encerrado.', 'Se ainda estiver aguardando, peça um novo link ao entregador.', '0%']
    };
    const [status, title, description, progress] = labels[data.status] || labels.waiting;
    $('deliveryStatus').textContent = status;
    $('headline').textContent = title;
    const future = Number(data.eta) > Date.now();
    if (future && !['delivered', 'ended'].includes(data.status)) {
      const date = new Date(data.eta), time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const today = date.toLocaleDateString() === new Date().toLocaleDateString();
      $('headline').textContent += ` Chegada estimada ${today ? 'às' : date.toLocaleDateString('pt-BR') + ' às'} ${time}.`;
    }
    $('description').textContent = description;
    $('deliveryProgress').style.setProperty('--progress', progress);
    $('deliveryProgress').querySelectorAll('.dot').forEach((dot, i) => dot.classList.toggle('on', i === 0 || i === 1 && data.status !== 'waiting' || data.status === 'delivered'));
    $('orderRef').textContent = data.orderRef || 'Seu pedido';
    $('deliveryAddress').textContent = [data.street, data.municipality].filter(Boolean).join(', ');
    $('lastUpdate').textContent = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString('pt-BR') : 'O entregador atualiza o acompanhamento durante o trajeto.';
    if (!demo) notice(['next', 'nearby'].includes(data.status) && !data.position ? 'Aguardando sinal atualizado do entregador. A posição volta a aparecer quando o celular reconectar.' : '');
    draw(data);
  }
  async function load() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    try {
      const r = await fetch(`https://rotacerta-mobile.carlosjralfa.chatgpt.site/api/tracking?route=${encodeURIComponent(routeId)}`, {
        headers: { Authorization: `Bearer ${token}` }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000)
      });
      const data = await r.json();
      if (!r.ok) {
        if ([401, 404, 410].includes(r.status)) { clearInterval(timer); lastData = null; $('headline').textContent = 'Acompanhamento indisponível'; $('description').textContent = data.error; if (driverMarker && map) map.removeLayer(driverMarker); if (accuracyCircle && map) map.removeLayer(accuracyCircle); }
        else throw new Error(data.error || 'Tente novamente em instantes.');
        return;
      }
      render(data);
    } catch (_) { if (lastData) render(lastData); notice('Não consegui atualizar agora. Confira a conexão; tentaremos novamente automaticamente.'); }
    finally { inFlight = false; }
  }
  $('back').onclick = () => history.length > 1 ? history.back() : location.assign('./index.html');
  $('center').onclick = fit;
  $('share').onclick = async () => {
    try { if (navigator.share) await navigator.share({ title: 'Acompanhe sua entrega', url: location.href }); else { await navigator.clipboard.writeText(location.href); notice('Link copiado.'); } }
    catch (error) { if (error.name !== 'AbortError') notice('Não consegui compartilhar este link.'); }
  };
  if (demo) {
    $('demoBadge').hidden = false;
    notice('Esta é uma prévia visual com dados ilustrativos. O link real de cada pedido é gerado pelo entregador.');
    render({ orderRef: 'Pedido de exemplo', street: 'Seu endereço de entrega', municipality: 'Belém - PA', status: 'next', destination: { lat: -1.435, lon: -48.455 }, position: { lat: -1.444, lon: -48.464, accuracy: 90 }, updatedAt: Date.now(), eta: Date.now() + 12 * 60000 });
  } else if (!routeId || !token) {
    $('headline').textContent = 'Abra o link da sua entrega.'; $('description').textContent = 'Peça ao entregador o link individual do seu pedido para acompanhar por aqui.';
    $('customerMap').innerHTML = '<div class="map-fallback">Seu mapa aparece quando você abre o link enviado pelo entregador.</div>';
  } else { load(); timer = setInterval(load, 15000); document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); }); }
  setInterval(() => { if (lastData?.position && Date.now() - lastData.updatedAt >= 60000) render(lastData); }, 5000);
})();
