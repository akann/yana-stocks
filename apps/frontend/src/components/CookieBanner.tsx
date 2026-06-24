'use client';

import React from 'react';
import { useCookieConsent } from '@/hooks/useCookieConsent';

export function CookieBanner(): React.JSX.Element | null {
  const { status, ready, accept, decline } = useCookieConsent();

  if (!ready || status !== null) return null;

  return (
    <div className="w-full bg-gray-100 border-b border-gray-300 px-4 py-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          We store session tokens in your browser&apos;s sessionStorage to keep you signed in. No
          tracking or third-party cookies are used.{' '}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={decline}
            className="text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-md border border-gray-300 hover:border-gray-400 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="text-sm bg-blue-600 hover:bg-blue-700 text-gray-900 px-3 py-1.5 rounded-md transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
