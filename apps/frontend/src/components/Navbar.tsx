'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { SymbolSearch } from './SymbolSearch';

function NavLink({
  href,
  children,
  className = 'px-3 py-1',
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== '/' && pathname.startsWith(href));
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={`${className} text-sm font-medium rounded transition-colors ${
        active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white hover:bg-white/10'
      }`}
    >
      {children}
    </Link>
  );
}

function NavLinks({ mobile = false, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { isAuthenticated } = useAuth();
  const linkClass = mobile ? 'block px-3 py-2' : undefined;
  return (
    <>
      <NavLink href="/" className={linkClass} onNavigate={onNavigate}>
        Market
      </NavLink>
      {isAuthenticated && (
        <>
          <NavLink href="/dashboard" className={linkClass} onNavigate={onNavigate}>
            Dashboard
          </NavLink>
          <NavLink href="/portfolio" className={linkClass} onNavigate={onNavigate}>
            Portfolio
          </NavLink>
          <NavLink href="/watchlist" className={linkClass} onNavigate={onNavigate}>
            Watchlist
          </NavLink>
        </>
      )}
    </>
  );
}

export function Navbar(): React.JSX.Element {
  const { isAuthenticated, logout, profile } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
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
    <nav className="sticky top-0 z-50 bg-[#1B2A4A] border-b border-[#0D1A30]">
      <div className="max-w-7xl mx-auto px-4 h-11 flex items-center justify-between">
        {/* Hamburger + brand + nav links */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-expanded={mobileOpen}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="md:hidden p-1.5 -ml-1.5 mr-1 text-gray-300 hover:text-white transition-colors"
          >
            {mobileOpen ? (
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            ) : (
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>

          <Link href="/" className="text-white font-bold text-base tracking-tight mr-4 shrink-0">
            yana<span className="text-blue-400">stocks</span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            <NavLinks />
          </div>
        </div>

        <SymbolSearch />

        {/* Right side */}
        <div className="flex items-center gap-2 text-sm">
          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-label={`Account menu for ${profile?.displayName ?? 'My Account'}`}
                className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors px-2 py-1 rounded hover:bg-white/10"
              >
                <span className="hidden sm:block text-sm">
                  {profile?.displayName ?? 'My Account'}
                </span>
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

      {/* Mobile panel — search + stacked nav links */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#0D1A30] px-4 py-3 space-y-3">
          <SymbolSearch className="block w-full" onNavigate={() => setMobileOpen(false)} />
          <div className="flex flex-col gap-1">
            <NavLinks mobile onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </nav>
  );
}
