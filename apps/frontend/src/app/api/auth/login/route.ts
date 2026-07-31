import { NextResponse } from 'next/server';
import { resolveUpstream } from '@/lib/bff/upstream';
import { setAuthCookies, setMfaTokenCookie, type TokenPair } from '@/lib/bff/cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LoginBody {
  email?: string;
  password?: string;
}

type UpstreamLoginResponse = { mfaRequired: true; mfaToken: string } | TokenPair;

export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as LoginBody;

  const upstreamRes = await fetch(`${resolveUpstream(['auth'])}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });

  if (!upstreamRes.ok) {
    const errorBody: unknown = await upstreamRes.json().catch(() => ({}));
    return NextResponse.json(errorBody, { status: upstreamRes.status });
  }

  const data = (await upstreamRes.json()) as UpstreamLoginResponse;

  if ('mfaToken' in data) {
    const res = NextResponse.json({ mfaRequired: true });
    setMfaTokenCookie(res, data.mfaToken);
    return res;
  }

  const res = NextResponse.json({ mfaRequired: false });
  setAuthCookies(res, data);
  return res;
}
