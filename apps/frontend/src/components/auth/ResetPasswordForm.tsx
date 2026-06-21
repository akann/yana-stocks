'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

const INPUT =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';

function ResetPasswordInner(): React.JSX.Element {
  const params = useSearchParams();
  const token = params.get('token');
  const router = useRouter();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-red-400">Invalid or missing reset link.</p>
          <Link href="/forgot-password" className="block text-blue-400 hover:text-blue-300 text-sm">
            Request a new one
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-white">Password updated</p>
          <p className="text-gray-400 text-sm">You can now sign in with your new password.</p>
          <Link href="/login" className="block text-blue-400 hover:text-blue-300 text-sm">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/auth/password/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Reset failed');
      }
      setDone(true);
      setTimeout(() => router.replace('/login'), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-2 text-center">Set new password</h1>
        <p className="text-gray-400 text-sm text-center mb-6">Choose a strong password.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">New password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              className={INPUT}
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Resetting…' : 'Reset password'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ResetPasswordForm(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-gray-400 text-sm">Loading…</p>
        </div>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
