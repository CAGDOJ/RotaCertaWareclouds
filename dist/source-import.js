(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const KEY = 'rota-spx-test-v1';
  const fileInput = $('spxFile');
  const button = $('importSPX');
  let reading = false;
  function status(message, error = false) {
    $('spxImportStatus').textContent = message;
    $('spxImportStatus').className = 'status' + (error ? ' error' : ' good');
  }
  function currentRoute() {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null');
    return value && Array.isArray(value.stops) ? value : null;
  }
  function refreshResume() {
    try {
      const current = currentRoute();
      $('resumeSPX').hidden = !current?.stops.length;
      if (current?.stops.length) $('resumeSPX').textContent = `Continuar minha rota SPX · ${current.stops.length} pedidos`;
    } catch { $('resumeSPX').hidden = true; }
  }
  button.addEventListener('click', () => { if (!reading) fileInput.click(); });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || reading) return;
    reading = true; button.disabled = true;
    status('Lendo seu romaneio SPX…');
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('Selecione o arquivo .xlsx baixado no aplicativo SPX.');
      if (file.size > 5 * 1024 * 1024) throw new Error('O arquivo deve ter até 5 MB.');
      if (!window.SPXReader || !window.JSZip || !window.xml2js) throw new Error('O leitor não carregou. Confira a conexão e atualize a página.');
      const parsed = await window.SPXReader.read(await file.arrayBuffer(), window.JSZip, window);
      const previous = currentRoute();
      if (previous?.session && previous.session.expiresAt > Date.now()) throw new Error('Você tem links SPX ativos. Abra sua rota SPX e encerre o acompanhamento antes de substituir o romaneio.');
      if (previous?.stops.length && !confirm(`Substituir os ${previous.stops.length} pedidos da sua rota SPX pelo novo romaneio?`)) {
        status('Importação cancelada. Sua rota anterior foi mantida.'); return;
      }
      localStorage.setItem(KEY, JSON.stringify({
        stops: parsed.stops, session: null, activeId: null, paused: false,
        fileName: file.name, service: previous?.service ?? 3
      }));
      status(`${parsed.stops.length} pedidos importados. Abrindo sua rota SPX…`);
      location.assign(new URL('./spx/', location.href).href);
    } catch (error) {
      status(error.name === 'QuotaExceededError' ? 'Sem espaço no navegador. Sua rota anterior foi mantida.' : (error.message || 'Não foi possível ler este arquivo.'), true);
    } finally {
      reading = false; button.disabled = false; fileInput.value = ''; refreshResume();
    }
  });
  refreshResume();
  window.addEventListener('pageshow', refreshResume);
})();
