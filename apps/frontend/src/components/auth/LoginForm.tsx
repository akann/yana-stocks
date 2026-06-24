'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export function LoginForm(): React.JSX.Element {
  const { login, verifyMFALogin, mfaRequired } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(email, password);
      if (!result.mfaRequired) {
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleTOTPSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await verifyMFALogin(totpCode);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  }

  if (mfaRequired) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
            Two-factor authentication
          </h1>
          <p className="text-gray-600 text-sm text-center mb-6">
            Enter the 6-digit code from your authenticator app.
          </p>
          <form onSubmit={handleTOTPSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Authentication code</label>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 text-center text-xl tracking-widest"
                required
                autoFocus
              />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading || totpCode.length !== 6}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Sign in</h1>
        <form onSubmit={handleCredentialsSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className="block text-sm text-gray-600 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="login-password" className="text-sm text-gray-600">
                Password
              </label>
              <Link href="/forgot-password" className="text-xs text-blue-600 hover:text-blue-300">
                Forgot password?
              </Link>
            </div>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          No account?{' '}
          <Link href="/register" className="text-blue-600 hover:text-blue-300">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
