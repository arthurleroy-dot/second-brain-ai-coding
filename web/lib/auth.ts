// Protection d'accès par mot de passe partagé.
// Cookie signé HMAC-SHA256 (Web Crypto → compatible Edge middleware ET Node).
// Config : SITE_PASSWORD (mot de passe) + SITE_SECRET (clé de signature).

export const AUTH_COOKIE = 'sb_auth';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

/** Signe un jeton d'authentification avec une expiration. */
export async function signToken(secret: string, now: number): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: now + TTL_MS })));
  const sig = await hmac(secret, payload);
  return `${payload}.${sig}`;
}

/** Vérifie signature + expiration. `now` en ms. */
export async function verifyToken(
  secret: string,
  token: string | undefined,
  now: number,
): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  const expected = await hmac(secret, payload);
  // Comparaison à temps ~constant.
  if (sig.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return false;

  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    return typeof json.exp === 'number' && json.exp > now;
  } catch {
    return false;
  }
}
