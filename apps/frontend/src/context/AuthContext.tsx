'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { generateVerifier, deriveChallenge, generateState, saveVerifier, loadVerifier, clearVerifier } from '@/lib/pkce';

const AUTHENTIK_URL = process.env.NEXT_PUBLIC_AUTHENTIK_URL ?? 'https://authentik.yanatech.co.uk';
const CLIENT_ID = process.env.NEXT_PUBLIC_AUTHENTIK_CLIENT_ID ?? 'yana-stocks';
const REDIRECT_URI = process.env.NEXT_PUBLIC_REDIRECT_URI ?? (typeof window !== 'undefined' ? `${window.location.origin}/callback` : '');

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

interface AuthContextValue {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  initiateLogin: () => Promise<void>;
  handleCallback: (code: string, state: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (token) setAccessToken(token);
    setIsLoading(false);
  }, []);

  async function initiateLogin(): Promise<void> {
    const verifier = generateVerifier();
    const state = generateState();
    const challenge = await deriveChallenge(verifier);
    saveVerifier(verifier, state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'openid profile email offline_access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });

    window.location.href = `${AUTHENTIK_URL}/application/o/authorize/?${params.toString()}`;
  }

  async function handleCallback(code: string, returnedState: string): Promise<void> {
    const saved = loadVerifier();
    if (!saved || saved.state !== returnedState) {
      throw new Error('State mismatch — possible CSRF');
    }
    clearVerifier();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: saved.verifier,
    });

    const res = await fetch(`${AUTHENTIK_URL}/application/o/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error('Token exchange failed');
    }

    const tokens = await res.json() as { access_token: string; refresh_token?: string };
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
    if (tokens.refresh_token) sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
    setAccessToken(tokens.access_token);
  }

  function logout(): void {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);

    // Redirect to Authentik end_session endpoint to clear the SSO session
    const params = new URLSearchParams({ client_id: CLIENT_ID });
    if (token) params.set('id_token_hint', token);
    window.location.href = `${AUTHENTIK_URL}/application/o/yana-stocks/end-session/?${params.toString()}`;
  }

  return (
    <AuthContext.Provider value={{ accessToken, isAuthenticated: !!accessToken, isLoading, initiateLogin, handleCallback, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
