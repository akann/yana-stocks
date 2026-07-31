/** @jest-environment node */
import { NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  MFA_TOKEN_COOKIE,
  setAuthCookies,
  setMfaTokenCookie,
  clearAuthCookies,
  clearMfaTokenCookie,
} from '../cookies';

describe('bff/cookies', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, configurable: true });
  });

  it('sets access_token as httpOnly, sameSite=lax, Path=/, 15min maxAge, no domain', () => {
    const res = NextResponse.json({});
    setAuthCookies(res, { accessToken: 'AT', refreshToken: 'RT' });

    const cookie = res.cookies.get(ACCESS_TOKEN_COOKIE);
    expect(cookie?.value).toBe('AT');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(900);
    expect(cookie?.domain).toBeUndefined();
  });

  it('sets refresh_token as httpOnly, sameSite=lax, Path=/api (not /api/auth), 7d maxAge, no domain', () => {
    const res = NextResponse.json({});
    setAuthCookies(res, { accessToken: 'AT', refreshToken: 'RT' });

    const cookie = res.cookies.get(REFRESH_TOKEN_COOKIE);
    expect(cookie?.value).toBe('RT');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/api');
    expect(cookie?.maxAge).toBe(604_800);
    expect(cookie?.domain).toBeUndefined();
  });

  it('marks cookies Secure in production', () => {
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true });
    const res = NextResponse.json({});
    setAuthCookies(res, { accessToken: 'AT', refreshToken: 'RT' });
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE)?.secure).toBe(true);
  });

  it('sets mfa_token scoped to /api/auth with a 5min maxAge', () => {
    const res = NextResponse.json({});
    setMfaTokenCookie(res, 'MFA123');
    const cookie = res.cookies.get(MFA_TOKEN_COOKIE);
    expect(cookie?.value).toBe('MFA123');
    expect(cookie?.path).toBe('/api/auth');
    expect(cookie?.maxAge).toBe(300);
  });

  it('clearAuthCookies expires both cookies at their own path', () => {
    const res = NextResponse.json({});
    clearAuthCookies(res);
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(res.cookies.get(ACCESS_TOKEN_COOKIE)?.path).toBe('/');
    expect(res.cookies.get(REFRESH_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(res.cookies.get(REFRESH_TOKEN_COOKIE)?.path).toBe('/api');
  });

  it('clearMfaTokenCookie expires the mfa cookie at /api/auth', () => {
    const res = NextResponse.json({});
    clearMfaTokenCookie(res);
    expect(res.cookies.get(MFA_TOKEN_COOKIE)?.maxAge).toBe(0);
    expect(res.cookies.get(MFA_TOKEN_COOKIE)?.path).toBe('/api/auth');
  });
});
