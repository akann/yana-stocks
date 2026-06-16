'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function CallbackPage(): React.JSX.Element {
  const { handleCallback } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = params.get('code');
    const state = params.get('state');
    const errorParam = params.get('error');

    if (errorParam) {
      setError(`Authentication error: ${params.get('error_description') ?? errorParam}`);
      return;
    }

    if (!code || !state) {
      setError('Missing code or state parameter.');
      return;
    }

    handleCallback(code, state)
      .then(() => router.replace('/dashboard'))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Authentication failed.');
      });
  }, [handleCallback, params, router]);

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-red-400">{error}</p>
          <a href="/login" className="text-blue-400 hover:text-blue-300 text-sm">
            Back to sign in
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <p className="text-gray-400 text-sm">Signing you in…</p>
    </div>
  );
}
