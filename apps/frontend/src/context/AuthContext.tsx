'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

// Always same-origin now — the BFF (this app's own /api/[...path] route
// handler) is what talks to the real backend server-to-server, attaching
// Authorization from the httpOnly access_token cookie. The browser never
// calls api-gateway.yanatech.co.uk directly anymore.
const API_URL = '/api';

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
  isAuthenticated: boolean;
  isLoading: boolean;
  mfaRequired: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  verifyMFALogin: (code: string) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (dto: UpdateProfileInput) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
  getMFAStatus: () => Promise<boolean>;
  setupMFA: () => Promise<MFASetupData>;
  enableMFA: (code: string) => Promise<void>;
  disableMFA: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function fetchIdentity(): Promise<AuthUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as AuthUser;
  } catch {
    return null;
  }
}

async function fetchProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_URL}/profile/me`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    return (await res.json()) as UserProfile;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mfaRequired, setMfaRequired] = useState(false);

  const clearSession = useCallback(() => {
    setUser(null);
    setProfile(null);
    setMfaRequired(false);
  }, []);

  const loadUserData = useCallback(async (): Promise<void> => {
    const [identity, prof] = await Promise.all([fetchIdentity(), fetchProfile()]);
    setUser(identity);
    setProfile(prof);
  }, []);

  // Every mutating/protected call: the BFF already attempted a transparent
  // refresh server-side, so a 401 reaching here means genuinely logged out —
  // clear local state (drives isAuthenticated) rather than retrying again.
  const authedFetch = useCallback(
    async (url: string, init: RequestInit = {}): Promise<Response> => {
      const res = await fetch(url, { ...init, credentials: 'same-origin' });
      if (res.status === 401) clearSession();
      return res;
    },
    [clearSession],
  );

  useEffect(() => {
    void (async () => {
      const identity = await fetchIdentity();
      if (identity) {
        setUser(identity);
        void fetchProfile().then(setProfile);
      }
      setIsLoading(false);
    })();
  }, []);

  async function login(email: string, password: string): Promise<{ mfaRequired: boolean }> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(body.error ?? body.message ?? 'Login failed');
    }

    const data = (await res.json()) as { mfaRequired: boolean };
    if (data.mfaRequired) {
      setMfaRequired(true);
      return { mfaRequired: true };
    }

    await loadUserData();
    return { mfaRequired: false };
  }

  async function verifyMFALogin(code: string): Promise<void> {
    const res = await fetch(`${API_URL}/auth/mfa/verify`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: JSON_HEADERS,
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Invalid code');
    }
    setMfaRequired(false);
    await loadUserData();
  }

  async function logout(): Promise<void> {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(
      () => undefined,
    );
    clearSession();
  }

  async function updateProfile(dto: UpdateProfileInput): Promise<void> {
    const res = await authedFetch(`${API_URL}/profile/me`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(dto),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    setProfile((await res.json()) as UserProfile);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const res = await authedFetch(`${API_URL}/auth/password`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to change password');
    }
  }

  async function getMFAStatus(): Promise<boolean> {
    const res = await authedFetch(`${API_URL}/auth/mfa`);
    if (!res.ok) throw new Error('Failed to get MFA status');
    const body = (await res.json()) as { enabled: boolean };
    return body.enabled;
  }

  async function setupMFA(): Promise<MFASetupData> {
    const res = await authedFetch(`${API_URL}/auth/mfa/setup`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to generate MFA secret');
    return (await res.json()) as MFASetupData;
  }

  async function enableMFA(code: string): Promise<void> {
    const res = await authedFetch(`${API_URL}/auth/mfa/enable`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ code }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Invalid code');
    }
  }

  async function disableMFA(): Promise<void> {
    const res = await authedFetch(`${API_URL}/auth/mfa`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to disable MFA');
  }

  async function deleteAccount(password: string): Promise<void> {
    const res = await authedFetch(`${API_URL}/auth/account`, {
      method: 'DELETE',
      headers: JSON_HEADERS,
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
        isAuthenticated: !!user,
        isLoading,
        mfaRequired,
        user,
        profile,
        login,
        verifyMFALogin,
        logout,
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
