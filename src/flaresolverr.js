/**
 * FlareSolverr Client
 * Resolve Cloudflare challenges via container Docker.
 * 
 * Uso:
 *   const { solvePage, solveUrl } = require('./flaresolverr');
 *   
 *   // Pegar HTML de página protegida
 *   const { html, cookies, userAgent } = await solveUrl('https://nissei.com/br/celulares');
 *   
 *   // Pegar cookies pra usar no fetch
 *   const { cookies } = await solveCookies('https://cellshop.com');
 */

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://localhost:8191/v1';
const TIMEOUT = 60000; // 60s max pra resolver challenge

/**
 * Resolve uma URL via FlareSolverr e retorna HTML + cookies
 */
async function solveUrl(url, options = {}) {
  const body = {
    cmd: 'request.get',
    url,
    maxTimeout: options.timeout || TIMEOUT,
  };

  if (options.cookies) body.cookies = options.cookies;
  if (options.returnOnlyCookies) body.returnOnlyCookies = true;

  const response = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`FlareSolverr HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'ok') {
    throw new Error(`FlareSolverr: ${data.message || data.status}`);
  }

  return {
    html: data.solution?.response || '',
    url: data.solution?.url || url,
    status: data.solution?.status || 0,
    cookies: data.solution?.cookies || [],
    userAgent: data.solution?.userAgent || '',
    headers: data.solution?.headers || {},
  };
}

/**
 * Só resolve cookies (mais rápido, útil pra depois usar com fetch/GraphQL)
 */
async function solveCookies(url) {
  return solveUrl(url, { returnOnlyCookies: true });
}

/**
 * Faz POST via FlareSolverr (pra GraphQL por exemplo)
 */
async function solvePost(url, postData, options = {}) {
  const body = {
    cmd: 'request.post',
    url,
    maxTimeout: options.timeout || TIMEOUT,
    postData: typeof postData === 'string' ? postData : JSON.stringify(postData),
  };

  if (options.cookies) body.cookies = options.cookies;

  const response = await fetch(FLARESOLVERR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (data.status !== 'ok') throw new Error(`FlareSolverr POST: ${data.message || data.status}`);

  return {
    body: data.solution?.response || '',
    cookies: data.solution?.cookies || [],
    userAgent: data.solution?.userAgent || '',
    status: data.solution?.status || 0,
  };
}

/**
 * Converte cookies do FlareSolverr pro formato de header Cookie
 */
function cookiesToHeader(cookies) {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

/**
 * Testa se FlareSolverr está acessível
 */
async function testConnection() {
  try {
    const r = await fetch(FLARESOLVERR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: 'sessions.list' }),
    });
    const d = await r.json();
    return { ok: true, sessions: d.sessions?.length || 0 };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { solveUrl, solveCookies, solvePost, cookiesToHeader, testConnection, FLARESOLVERR_URL };
