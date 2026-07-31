import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';

// jsdom's test environment here has no global Response/Request — plain
// Response-shaped objects match what AuthContext.tsx actually reads (ok,
// status, json()) without depending on those globals existing.
function mockRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function Probe() {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <span>loading</span>;
  return <span>{isAuthenticated ? `authed:${user?.email}` : 'anonymous'}</span>;
}

describe('AuthContext', () => {
  let mockFetch: jest.Mock;
  const originalFetch = global.fetch;
  let sessionStorageSpy: jest.SpyInstance;

  beforeEach(() => {
    mockFetch = jest.fn();
    global.fetch = mockFetch as unknown as typeof fetch;
    sessionStorageSpy = jest.spyOn(Storage.prototype, 'setItem');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    sessionStorageSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('derives isAuthenticated from a 200 on GET /api/auth/me, and fetches the profile', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.toString().includes('/api/auth/me')) {
        return Promise.resolve(mockRes(200, { userId: 'u1', email: 'a@b.com' }));
      }
      if (url.toString().includes('/api/profile/me')) {
        return Promise.resolve(
          mockRes(200, {
            displayName: 'A',
            avatar: '',
            bio: '',
            preferences: {
              theme: 'light',
              defaultCurrency: 'USD',
              emailNotifications: true,
              defaultMarket: 'US',
            },
          }),
        );
      }
      return Promise.resolve(mockRes(404, {}));
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('authed:a@b.com')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenCalledWith('/api/auth/me', expect.anything());
  });

  it('derives isAuthenticated=false from a 401 on GET /api/auth/me', async () => {
    mockFetch.mockResolvedValue(mockRes(401, {}));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
  });

  it('never writes any sessionStorage key', async () => {
    mockFetch.mockResolvedValue(mockRes(401, {}));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it('login() posts credentials with no manual Authorization header', async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (url.toString().includes('/api/auth/login')) {
        expect(init?.headers).not.toHaveProperty('Authorization');
        return Promise.resolve(mockRes(200, { mfaRequired: false }));
      }
      return Promise.resolve(mockRes(401, {}));
    });

    const authRef: { current: ReturnType<typeof useAuth> | undefined } = { current: undefined };
    function Capture() {
      const value = useAuth();
      useEffect(() => {
        authRef.current = value;
      });
      return null;
    }

    render(
      <AuthProvider>
        <Capture />
      </AuthProvider>,
    );

    await waitFor(() => expect(authRef.current).toBeDefined());
    const result = await act(() => authRef.current!.login('a@b.com', 'pw'));
    expect(result).toEqual({ mfaRequired: false });
  });
});
