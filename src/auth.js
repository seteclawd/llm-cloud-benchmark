// Basic Auth mínimo para Cloudflare Workers.
// Usuarios en el secreto AUTH_USERS, formato "usuario:contraseña,usuario:contraseña".
// Falla cerrado: sin secreto, nadie entra.

const enc = new TextEncoder();

function safeEqual(a, b) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length, 1);
  for (let i = 0; i < n; i++) {
    diff |= x[i % (x.length || 1)] ^ y[i % (y.length || 1)];
  }
  return diff === 0;
}

export function parseUsers(env) {
  const raw = (env && env.AUTH_USERS) || "";
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf(":");
      return i === -1 ? null : [pair.slice(0, i), pair.slice(i + 1)];
    })
    .filter(Boolean);
}

export function isAuthorized(request, env) {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return false;
  let decoded;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const i = decoded.indexOf(":");
  if (i === -1) return false;
  const user = decoded.slice(0, i);
  const pass = decoded.slice(i + 1);
  const users = parseUsers(env);
  if (!users.length) return false;
  let ok = 0;
  for (const [u, p] of users) {
    // se comparan todos para no revelar qué usuario existe
    const match = safeEqual(u, user) & safeEqual(p, pass);
    ok |= match ? 1 : 0;
  }
  return ok === 1;
}

export function unauthorized() {
  return new Response("401 — Autenticación requerida\n", {
    status: 401,
    headers: {
      "www-authenticate": 'Basic realm="Hermes Nan", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
