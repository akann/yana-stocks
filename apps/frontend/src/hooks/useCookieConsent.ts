'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cookie_consent';

export type ConsentStatus = 'accepted' | 'declined' | null;

interface ConsentRecord {
  status: 'accepted' | 'declined';
  timestamp: number;
}

export function useCookieConsent() {
  const [status, setStatus] = useState<ConsentStatus>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const rec = JSON.parse(raw) as ConsentRecord;
        return rec.status;
      }
    } catch {
      // ignore parse errors
    }
    return null;
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  function record(choice: 'accepted' | 'declined') {
    const entry: ConsentRecord = { status: choice, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    setStatus(choice);
  }

  return { status, ready, accept: () => record('accepted'), decline: () => record('declined') };
}
