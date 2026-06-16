'use client';

import React, { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api';

function VerifyInner(): React.JSX.Element {
  const params = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('Missing verification token.');
      return;
    }

    fetch(`${API_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        if (res.ok) {
          setStatus('success');
          setMessage('Email verified! You can now sign in.');
        } else {
          const body = await res.json().catch(() => ({})) as { message?: string };
          setStatus('error');
          setMessage(body.message ?? 'Verification failed. The link may have expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, [params]);

  if (status === 'loading') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-gray-400 text-sm">Verifying your email…</p>
      </div>
    );
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="text-4xl">{status === 'success' ? '✅' : '❌'}</div>
        <p className={status === 'success' ? 'text-white' : 'text-red-400'}>{message}</p>
        <Link href="/login" className="block text-blue-400 hover:text-blue-300 text-sm">
          Go to sign in
        </Link>
      </div>
    </div>
  );
}

export function VerifyEmailPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <p className="text-gray-400 text-sm">Verifying your email…</p>
        </div>
      }
    >
      <VerifyInner />
    </Suspense>
  );
}
