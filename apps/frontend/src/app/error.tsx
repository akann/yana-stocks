'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-gray-900">Something went wrong</h1>
      <p className="text-gray-600">We&apos;ve been notified and are looking into it.</p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-gray-900 px-4 py-2 text-white hover:bg-gray-700"
      >
        Try again
      </button>
    </div>
  );
}
