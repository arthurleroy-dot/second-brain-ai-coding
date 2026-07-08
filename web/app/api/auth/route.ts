import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, signToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  const secret = process.env.SITE_SECRET;
  if (!password || !secret) {
    // Pas de protection configurée : on considère l'accès ouvert.
    return NextResponse.json({ ok: true });
  }

  let submitted = '';
  try {
    const body = await req.json();
    submitted = String(body?.password ?? '');
  } catch {
    return NextResponse.json({ error: 'Requête invalide' }, { status: 400 });
  }

  if (submitted !== password) {
    return NextResponse.json({ error: 'Mot de passe incorrect' }, { status: 401 });
  }

  const token = await signToken(secret, Date.now());
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
  return res;
}
