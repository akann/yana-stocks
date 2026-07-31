/** @jest-environment node */
import { POST } from '../route';

function req(body: unknown) {
  return new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/login', () => {
  let mockFetch: jest.Mock;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    process.env.AUTH_SERVICE_URL = 'http://auth.test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.AUTH_SERVICE_URL;
    jest.clearAllMocks();
  });

  it('sets access_token/refresh_token cookies and returns no tokens in the body on success', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'AT', refreshToken: 'RT' }), { status: 200 }),
    );

    const res = await POST(req({ email: 'a@b.com', password: 'pw' }));
    const body = (await res.json()) as { mfaRequired: boolean };

    expect(body).toEqual({ mfaRequired: false });
    expect(JSON.stringify(body)).not.toContain('AT');
    expect(res.cookies.get('access_token')?.value).toBe('AT');
    expect(res.cookies.get('refresh_token')?.value).toBe('RT');
  });

  it('sets only the mfa_token cookie (never accessToken/refreshToken) when MFA is required', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ mfaRequired: true, mfaToken: 'MFA1' }), { status: 200 }),
    );

    const res = await POST(req({ email: 'a@b.com', password: 'pw' }));
    const body = (await res.json()) as { mfaRequired: boolean };

    expect(body).toEqual({ mfaRequired: true });
    expect(res.cookies.get('mfa_token')?.value).toBe('MFA1');
    expect(res.cookies.get('access_token')).toBeUndefined();
    expect(res.cookies.get('refresh_token')).toBeUndefined();
  });

  it('forwards the upstream error status/body on failed login without setting cookies', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Invalid credentials' }), {
        status: 401,
      }),
    );

    const res = await POST(req({ email: 'a@b.com', password: 'wrong' }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe('Invalid credentials');
    expect(res.cookies.get('access_token')).toBeUndefined();
  });
});
