'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import axios from 'axios';

export function RegisterForm(): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';
      await axios.post(`${apiBase}/auth/register`, { email, name: name || undefined, password });
      setDone(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError('Email already registered.');
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-4xl">📧</div>
          <h1 className="text-2xl font-bold text-gray-900">Check your inbox</h1>
          <p className="text-gray-600 text-sm">
            We sent a verification link to <span className="text-gray-900">{email}</span>. Click it
            to activate your account, then{' '}
            <Link href="/login" className="text-blue-600 hover:text-blue-300">
              sign in
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Create account</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="register-email" className="block text-sm text-gray-600 mb-1">
              Email
            </label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          <div>
            <label htmlFor="register-name" className="block text-sm text-gray-600 mb-1">
              Name (optional)
            </label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label htmlFor="register-password" className="block text-sm text-gray-600 mb-1">
              Password
            </label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
              className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500"
              required
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg font-medium transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-600 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-blue-600 hover:text-blue-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
