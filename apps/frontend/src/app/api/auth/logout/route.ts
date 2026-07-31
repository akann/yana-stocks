import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveUpstream } from '@/lib/bff/upstream';
import { REFRESH_TOKEN_COOKIE, clearAuthCookies } from '@/lib/bff/cookies';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  if (refreshToken) {
    await fetch(`${resolveUpstream(['auth'])}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }

  const res = NextResponse.json({ ok: true });
  clearAuthCookies(res);
  return res;
}
