'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

const ACCESS_TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export interface AuthUser {
  userId: string;
  email: string;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  defaultCurrency: string;
  emailNotifications: boolean;
  defaultMarket: 'US' | 'UK' | 'global';
}

export interface UserProfile {
  displayName: string;
  avatar: string;
  bio: string;
  preferences: UserPreferences;
}

export interface UpdateProfileInput {
  displayName?: string;
  avatar?: string;
  bio?: string;
  preferences?: Partial<UserPreferences>;
}

export interface MFASetupData {
  otpAuthURL: string;
  secret: string;
}

interface AuthContextValue {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  mfaRequired: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  verifyMFALogin: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (dto: UpdateProfileInput) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  getMFAStatus: () => Promise<boolean>;
  setupMFA: () => Promise<MFASetupData>;
  enableMFA: (code: string) => Promise<void>;
  disableMFA: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function fetchIdentity(token: string): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

async function fetchProfile(token: string): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_URL}/profile/me`, { headers: authHeaders(token) });
    if (!res.ok) return null;
    return (await res.json()) as UserProfile;
  } catch {
    return null;
  }
}

async function doRefresh(): Promise<string | null> {
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return tokens.accessToken;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaPendingToken, setMfaPendingToken] = useState<string | null>(null);

  const clearSession = useCallback(() => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
    setProfile(null);
  }, []);

  const loadUserData = useCallback(async (token: string): Promise<void> => {
    const [identity, prof] = await Promise.all([fetchIdentity(token), fetchProfile(token)]);
    setUser(identity);
    setProfile(prof);
  }, []);

  // Silently refresh the access token on 401 and retry the original request once.
  const fetchWithAuth = useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      const makeRequest = (token: string): Promise<Response> =>
        fetch(url, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${token}`,
          },
        });

      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) throw new Error('Not authenticated');

      const res = await makeRequest(token);
      if (res.status !== 401) return res;

      const newToken = await doRefresh();
      if (!newToken) {
        clearSession();
        throw new Error('Session expired');
      }

      setAccessToken(newToken);
      return makeRequest(newToken);
    },
    [clearSession],
  );

  useEffect(() => {
    void (async () => {
      const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
      if (!token) {
        setIsLoading(false);
        return;
      }

      setAccessToken(token);
      const identity = await fetchIdentity(token);
      if (identity) {
        setUser(identity);
        void fetchProfile(token).then(setProfile);
      } else {
        // Access token expired on startup — try silent refresh before logging out.
        const newToken = await doRefresh();
        if (newToken) {
          setAccessToken(newToken);
          await loadUserData(newToken);
        } else {
          clearSession();
        }
      }
      setIsLoading(false);
    })();
  }, [loadUserData, clearSession]);

  async function login(email: string, password: string): Promise<{ mfaRequired: boolean }> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(body.error ?? body.message ?? 'Login failed');
    }

    const data = (await res.json()) as
      | { mfaRequired: true; mfaToken: string }
      | { accessToken: string; refreshToken: string };

    if ('mfaRequired' in data && data.mfaRequired) {
      setMfaPendingToken(data.mfaToken);
      return { mfaRequired: true };
    }

    const tokens = data as { accessToken: string; refreshToken: string };
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    await loadUserData(tokens.accessToken);
    return { mfaRequired: false };
  }

  async function verifyMFALogin(code: string): Promise<void> {
    if (!mfaPendingToken) throw new Error('No MFA session');
    const res = await fetch(`${API_URL}/auth/mfa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfaToken: mfaPendingToken, code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Invalid code');
    }
    const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
    setMfaPendingToken(null);
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
    await loadUserData(tokens.accessToken);
  }

  async function logout(): Promise<void> {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    if (refreshToken) {
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }).catch(() => undefined);
    }
    clearSession();
  }

  async function refresh(): Promise<void> {
    const newToken = await doRefresh();
    if (!newToken) {
      clearSession();
      throw new Error('Session expired');
    }
    setAccessToken(newToken);
  }

  async function updateProfile(dto: UpdateProfileInput): Promise<void> {
    const res = await fetchWithAuth(`${API_URL}/profile/me`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    setProfile((await res.json()) as UserProfile);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await fetchWithAuth(`${API_URL}/auth/password`, {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to change password');
    }
  }

  async function getMFAStatus(): Promise<boolean> {
    const res = await fetchWithAuth(`${API_URL}/auth/mfa`);
    if (!res.ok) throw new Error('Failed to get MFA status');
    const body = (await res.json()) as { enabled: boolean };
    return body.enabled;
  }

  async function setupMFA(): Promise<MFASetupData> {
    const res = await fetchWithAuth(`${API_URL}/auth/mfa/setup`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to generate MFA secret');
    return (await res.json()) as MFASetupData;
  }

  async function enableMFA(code: string): Promise<void> {
    const res = await fetchWithAuth(`${API_URL}/auth/mfa/enable`, {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Invalid code');
    }
  }

  async function disableMFA(): Promise<void> {
    const res = await fetchWithAuth(`${API_URL}/auth/mfa`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to disable MFA');
  }

  async function deleteAccount(password: string): Promise<void> {
    const res = await fetchWithAuth(`${API_URL}/auth/account`, {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to delete account');
    }
    clearSession();
  }

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        isAuthenticated: !!user,
        isLoading,
        mfaRequired: !!mfaPendingToken,
        user,
        profile,
        login,
        verifyMFALogin,
        logout,
        refresh,
        updateProfile,
        changePassword,
        deleteAccount,
        getMFAStatus,
        setupMFA,
        enableMFA,
        disableMFA,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
