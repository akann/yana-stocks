'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

export function Navbar() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    logout();
    router.push('/login');
  }

  return (
    <nav className="bg-surface-800 border-b border-gray-700 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-white font-bold text-lg tracking-tight">
            yana<span className="text-blue-400">stocks</span>
          </Link>
          <div className="hidden md:flex items-center gap-4 text-sm text-gray-400">
            <Link href="/" className="hover:text-white transition-colors">Market</Link>
            {isAuthenticated && (
              <>
                <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
                <Link href="/portfolio" className="hover:text-white transition-colors">Portfolio</Link>
                <Link href="/watchlist" className="hover:text-white transition-colors">Watchlist</Link>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-white transition-colors"
            >
              Sign out
            </button>
          ) : (
            <>
              <Link href="/login" className="text-gray-400 hover:text-white transition-colors">Sign in</Link>
              <Link
                href="/register"
                className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md transition-colors"
              >
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
