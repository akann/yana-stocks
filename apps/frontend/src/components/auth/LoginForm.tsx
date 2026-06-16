'use client';

import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

export function LoginForm(): React.JSX.Element {
  const { initiateLogin } = useAuth();

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">Sign in</h1>
          <p className="text-gray-400 text-sm">Use your yana-stocks account</p>
        </div>
        <button
          onClick={() => void initiateLogin()}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-lg font-medium transition-colors"
        >
          Continue with Authentik
        </button>
        <p className="text-center text-sm text-gray-500">
          No account?{' '}
          <Link href="/register" className="text-blue-400 hover:text-blue-300">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
