import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, verifyToken } from '@/lib/auth';

// Protège toute l'app derrière un mot de passe partagé si SITE_PASSWORD est
// défini. En local (variable absente), aucune protection → dev sans friction.
export async function middleware(req: NextRequest) {
  const secret = process.env.SITE_SECRET;
  const password = process.env.SITE_PASSWORD;
  if (!password || !secret) return NextResponse.next();

  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (await verifyToken(secret, token, Date.now())) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

// Tout est protégé sauf : /login, la route d'auth, les assets Next et le favicon.
export const config = {
  matcher: ['/((?!login|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
