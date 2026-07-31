import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveUpstream } from '@/lib/bff/upstream';
import {
  MFA_TOKEN_COOKIE,
  clearMfaTokenCookie,
  setAuthCookies,
  type TokenPair,
} from '@/lib/bff/cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface VerifyBody {
  code?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const cookieStore = await cookies();
  const mfaToken = cookieStore.get(MFA_TOKEN_COOKIE)?.value;
  if (!mfaToken) {
    return NextResponse.json({ error: 'No MFA session' }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as VerifyBody;

  const upstreamRes = await fetch(`${resolveUpstream(['auth'])}/api/auth/mfa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mfaToken, code: body.code }),
    cache: 'no-store',
  });

  if (!upstreamRes.ok) {
    const errorBody: unknown = await upstreamRes.json().catch(() => ({}));
    const res = NextResponse.json(errorBody, { status: upstreamRes.status });
    if (upstreamRes.status !== 429) clearMfaTokenCookie(res);
    return res;
  }

  const tokens = (await upstreamRes.json()) as TokenPair;
  const res = NextResponse.json({ ok: true });
  clearMfaTokenCookie(res);
  setAuthCookies(res, tokens);
  return res;
}
