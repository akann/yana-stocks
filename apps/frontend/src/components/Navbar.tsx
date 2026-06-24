'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={`px-3 py-1 text-sm font-medium rounded transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </Link>
  );
}

export function Navbar(): React.JSX.Element {
  const { isAuthenticated, logout, profile } = useAuth();
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
    <nav className="bg-[#1B2A4A] border-b border-[#0D1A30]">
      <div className="max-w-7xl mx-auto px-4 h-11 flex items-center justify-between">
        {/* Brand + nav links */}
        <div className="flex items-center gap-1">
          <Link href="/" className="text-white font-bold text-base tracking-tight mr-4 shrink-0">
            yana<span className="text-blue-400">stocks</span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            <NavLink href="/">Market</NavLink>
            {isAuthenticated && (
              <>
                <NavLink href="/dashboard">Dashboard</NavLink>
                <NavLink href="/portfolio">Portfolio</NavLink>
                <NavLink href="/watchlist">Watchlist</NavLink>
              </>
            )}
          </div>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 text-sm">
          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
              >
                <span className="hidden sm:block text-sm">{profile?.name ?? 'My Account'}</span>
                <span className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white shrink-0 overflow-hidden">
                  {profile?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={profile.avatar} alt="avatar" className="w-7 h-7 object-cover" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 translate-y-1">
                      <circle cx="12" cy="8" r="4" />
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                  )}
                </span>
              </button>

              {menuOpen && (
                <div className="absolute right-0 mt-1 w-44 bg-[#1B2A4A] border border-[#0D1A30] rounded shadow-xl py-1 z-50">
                  <Link
                    href="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    Your profile
                  </Link>
                  <div className="border-t border-white/10 my-1" />
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void logout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10 text-sm"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-sm font-medium transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
