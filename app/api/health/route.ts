export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('probe') === 'wareclouds') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const upstream = await fetch('https://auth-api-prod-br-afon3vf7vq-ue.a.run.app/login/clouder', {
        method: 'GET', redirect: 'manual', signal: controller.signal
      });
      await upstream.body?.cancel();
      return Response.json({ status: 'reachable', upstreamStatus: upstream.status }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const type = error instanceof TypeError ? 'TYPE_ERROR' : controller.signal.aborted ? 'TIMEOUT' : 'CONNECTION_ERROR';
      return Response.json({ status: 'unreachable', code: type }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    } finally { clearTimeout(timer); }
  }
  return Response.json({ service: 'rota-certa', import: 'wareclouds-login', status: 'ready' }, {
    headers: { 'Cache-Control': 'no-store' }
  });
}
