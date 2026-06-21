'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

function avatarInitial(displayName: string | undefined, email: string | undefined): string {
  const src = displayName || email || '?';
  return src.charAt(0).toUpperCase();
}

export function Navbar(): React.JSX.Element {
  const { isAuthenticated, logout, profile, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <nav className="bg-surface-800 border-b border-gray-700 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-white font-bold text-lg tracking-tight">
            yana<span className="text-blue-400">stocks</span>
          </Link>
          <div className="hidden md:flex items-center gap-4 text-sm text-gray-400">
            <Link href="/" className="hover:text-white transition-colors">
              Market
            </Link>
            {isAuthenticated && (
              <>
                <Link href="/dashboard" className="hover:text-white transition-colors">
                  Dashboard
                </Link>
                <Link href="/portfolio" className="hover:text-white transition-colors">
                  Portfolio
                </Link>
                <Link href="/watchlist" className="hover:text-white transition-colors">
                  Watchlist
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <>
              <Link href="/profile" className="text-gray-400 hover:text-white transition-colors">
                My Account
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((o) => !o)}
                  className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
                >
                  <span className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-semibold select-none">
                    {avatarInitial(profile?.displayName, user?.email)}
                  </span>
                  <span className="hidden md:block text-sm">
                    {profile?.displayName || user?.email?.split('@')[0]}
                  </span>
                  <svg
                    className={`w-3 h-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                {menuOpen && (
                  <div className="absolute right-0 mt-2 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-50">
                    <Link
                      href="/profile"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                    >
                      Your profile
                    </Link>
                    <div className="border-t border-gray-700 my-1" />
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        void logout();
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/login" className="text-gray-400 hover:text-white transition-colors">
                Sign in
              </Link>
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
