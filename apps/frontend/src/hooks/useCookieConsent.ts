'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'cookie_consent';

export type ConsentStatus = 'accepted' | 'declined' | null;

interface ConsentRecord {
  status: 'accepted' | 'declined';
  timestamp: number;
}

export function useCookieConsent() {
  const [status, setStatus] = useState<ConsentStatus>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const record = JSON.parse(raw) as ConsentRecord;
        setStatus(record.status);
      }
    } catch {
      // ignore parse errors
    }
    setReady(true);
  }, []);

  function record(choice: 'accepted' | 'declined') {
    const entry: ConsentRecord = { status: choice, timestamp: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    setStatus(choice);
  }

  return { status, ready, accept: () => record('accepted'), decline: () => record('declined') };
}
