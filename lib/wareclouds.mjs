// Fixed endpoints from the public Wareclouds web client. Never log credentials or responses.
const AUTH_URL = 'https://auth-api-prod-br-afon3vf7vq-ue.a.run.app/login/clouder';
const ORDERS_URL = 'https://order-api-prod-br-afon3vf7vq-ue.a.run.app/clouders/orders/in-route-to-consumer?filter=&id_city=';
const ALLOWED_ORIGINS = new Set(['https://cagdoj.github.io', 'https://rotacerta-mobile.carlosjralfa.chatgpt.site']);
const attempts = new Map();
class ImportError extends Error {
  constructor(status, message, code = 'IMPORT_ERROR') { super(message); this.status = status; this.code = code; }
}
function text(value, max = 300) {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
}
function cors(request) {
  const origin = request.headers.get('Origin');
  return {
    'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {})
  };
}
function reply(request, payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { ...cors(request), ...extra } });
}
function rateLimit(request) {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  const current = attempts.get(key) || { count: 0, until: now + 60000 };
  if (current.count >= 8 || (!attempts.has(key) && attempts.size >= 1000)) return false;
  current.count += 1; attempts.set(key, current); return true;
}
async function readLimitedJSON(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new ImportError(415, 'Envie o login pelo formulário do Rota Certa.');
  if (Number(request.headers.get('Content-Length')) > 4096)
    throw new ImportError(413, 'O formulário excedeu o tamanho permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new ImportError(400, 'Informe seu usuário e senha da Wareclouds.');
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); throw new ImportError(413, 'O formulário excedeu o tamanho permitido.'); }
    parts.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ImportError(400, 'Confira seu usuário e senha.'); }
}
async function upstream(fetcher, url, options, phase) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    // Handle redirects explicitly: credentials must never follow to another host.
    response = await fetcher(url, { ...options, redirect: 'manual', signal: controller.signal });
  } catch (error) {
    const code = controller.signal.aborted ? `TIMEOUT_${phase.toUpperCase()}` : `CONNECTION_${phase.toUpperCase()}`;
    throw new ImportError(502, controller.signal.aborted
      ? 'A Wareclouds demorou para responder. Tente novamente.'
      : 'A conexão do importador com a Wareclouds falhou. Tente novamente em instantes.', code);
  } finally { clearTimeout(timer); }
  if (response.status >= 300 && response.status < 400)
    throw new ImportError(502, 'A conexão da Wareclouds mudou de endereço. A importação foi interrompida com segurança.', `REDIRECT_${phase.toUpperCase()}`);
  if (response.status === 401 || response.status === 403)
    throw new ImportError(401, phase === 'login'
      ? 'A Wareclouds não aceitou o login. Confira seu usuário e senha.'
      : 'A Wareclouds pediu um novo login. Entre novamente.');
  if (response.status === 429)
    throw new ImportError(429, 'A Wareclouds limitou as tentativas. Aguarde um minuto e tente novamente.');
  if (!response.ok) throw new ImportError(502, 'A Wareclouds está indisponível. Tente novamente em instantes.');
  try { return await response.json(); }
  catch { throw new ImportError(502, 'A Wareclouds respondeu em um formato inesperado. Tente novamente.', `FORMAT_${phase.toUpperCase()}`); }
}
export function sanitizeOrders(payload) {
  const data = payload?.data;
  if (!data || !Array.isArray(data.orders))
    throw new ImportError(502, 'A Wareclouds enviou uma lista em formato diferente. Tente novamente mais tarde.');
  const orders = data.orders.filter(Boolean);
  if (Number(data.total_pages) > 1 || Number(data.count) > orders.length)
    throw new ImportError(502, 'A Wareclouds enviou uma lista incompleta. Nenhuma entrega foi substituída; tente novamente.');
  if (orders.length > 1000) throw new ImportError(422, 'Há mais de 1.000 pedidos nesta conta. A lista excede o limite de importação.');
  let missing = 0;
  const stops = orders.map((order, i) => {
    const street = text(order.consumer_address);
    const municipality = text(order.consumer_city, 120);
    if (!street || !municipality) missing += 1;
    const digits = text(order.consumer_postal_code, 30).replace(/\D/g, '');
    const postalCode = digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : '';
    return {
      id: `wareclouds-${text(order.id_order, 80) || i}`,
      orderRef: text(order.order_code, 50) || `Pedido ${i + 1}`,
      street, municipality, block: '', postalCode,
      addressDetail: text(order.consumer_address_detail, 200),
      note: text(order.consumer_address_extra_info, 240),
      address: [street, municipality, postalCode, 'Brasil'].filter(Boolean).join(', '),
      lat: null, lon: null, done: false
    };
  });
  if (missing) throw new ImportError(422, `${missing} pedido(s) estão sem endereço ou município na Wareclouds. Complete esses dados e importe novamente.`);
  // Explicit allowlist excludes recipient identity and login tokens.
  return { stops, count: stops.length, missingPostalCode: stops.filter(s => !s.postalCode).length };
}
export async function handleImport(request, { fetcher = (url, options) => fetch(url, options), limiter = rateLimit } = {}) {
  if (!ALLOWED_ORIGINS.has(request.headers.get('Origin')))
    return reply(request, { error: 'Abra a importação pelo Rota Certa.' }, 403);
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: {
      ...cors(request), 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600'
    } });
  if (request.method !== 'POST') return reply(request, { error: 'Use o botão Importar.' }, 405, { Allow: 'POST, OPTIONS' });
  if (!limiter(request)) return reply(request, { error: 'Aguarde um minuto antes de tentar novamente.' }, 429, { 'Retry-After': '60' });
  try {
    const input = await readLimitedJSON(request);
    const username = typeof input?.username === 'string' ? input.username.trim() : '';
    const password = typeof input?.password === 'string' ? input.password : '';
    if (!username || username.length > 120 || /[:\r\n]/.test(username) || !password || password.length > 512)
      throw new ImportError(400, 'Informe seu usuário e senha da Wareclouds.');
    const bytes = new TextEncoder().encode(`${username}:${password}`);
    const basic = btoa(Array.from(bytes, n => String.fromCharCode(n)).join(''));
    const login = await upstream(fetcher, AUTH_URL, {
      method: 'POST', headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' }
    }, 'login');
    const token = login?.data?.accessToken || login?.accessToken;
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token))
      throw new ImportError(502, 'Não foi possível concluir o login da Wareclouds. Tente novamente.');
    const orders = await upstream(fetcher, ORDERS_URL, {
      method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    }, 'orders');
    return reply(request, sanitizeOrders(orders));
  } catch (error) {
    const known = error instanceof ImportError;
    const code = known ? error.code : 'IMPORT_RUNTIME';
    // Only fixed diagnostic codes are logged; never credentials, tokens or upstream bodies.
    if (!known || error.status >= 500) console.warn('wareclouds_import_failed', code);
    return reply(request, { error: known ? error.message : 'O importador encontrou uma falha interna. Tente novamente.', code }, known ? error.status : 502);
  }
}
