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

interface AuthContextValue {
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  updateProfile: (dto: UpdateProfileInput) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authHeaders(token: string) {
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

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUserData = useCallback(async (token: string): Promise<void> => {
    const [identity, prof] = await Promise.all([fetchIdentity(token), fetchProfile(token)]);
    setUser(identity);
    setProfile(prof);
  }, []);

  useEffect(() => {
    const token = sessionStorage.getItem(ACCESS_TOKEN_KEY);
    if (token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAccessToken(token);
      void loadUserData(token).finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, [loadUserData]);

  async function login(email: string, password: string): Promise<void> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(body.message ?? 'Login failed');
    }

    const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
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
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
    setProfile(null);
  }

  async function refresh(): Promise<void> {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) throw new Error('No refresh token');

    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      sessionStorage.removeItem(ACCESS_TOKEN_KEY);
      sessionStorage.removeItem(REFRESH_TOKEN_KEY);
      setAccessToken(null);
      setUser(null);
      setProfile(null);
      throw new Error('Session expired');
    }

    const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
    sessionStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    setAccessToken(tokens.accessToken);
  }

  async function updateProfile(dto: UpdateProfileInput): Promise<void> {
    if (!accessToken) throw new Error('Not authenticated');
    const res = await fetch(`${API_URL}/profile/me`, {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify(dto),
    });
    if (!res.ok) throw new Error('Failed to update profile');
    setProfile((await res.json()) as UserProfile);
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!accessToken) throw new Error('Not authenticated');
    const res = await fetch(`${API_URL}/auth/password`, {
      method: 'PUT',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to change password');
    }
  }

  async function deleteAccount(password: string): Promise<void> {
    if (!accessToken) throw new Error('Not authenticated');
    const res = await fetch(`${API_URL}/auth/account`, {
      method: 'DELETE',
      headers: authHeaders(accessToken),
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'Failed to delete account');
    }
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    setAccessToken(null);
    setUser(null);
    setProfile(null);
  }

  return (
    <AuthContext.Provider
      value={{
        accessToken,
        isAuthenticated: !!accessToken,
        isLoading,
        user,
        profile,
        login,
        logout,
        refresh,
        updateProfile,
        changePassword,
        deleteAccount,
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
