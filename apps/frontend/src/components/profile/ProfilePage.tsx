'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

type Tab = 'profile' | 'security';

const INPUT =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500';
const LABEL = 'block text-sm text-gray-400 mb-1';
const BTN =
  'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function ProfilePage(): React.JSX.Element {
  const {
    isAuthenticated,
    isLoading,
    user,
    profile,
    updateProfile,
    changePassword,
    deleteAccount,
  } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('profile');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-800 rounded-xl h-32 m-6" />;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Account</h1>
        <p className="text-gray-400 text-sm mt-1">{user?.email}</p>
      </div>

      <div className="flex border-b border-gray-700 mb-6">
        {(['profile', 'security'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              tab === t
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {t === 'security' ? 'Security' : 'Profile'}
          </button>
        ))}
      </div>

      {tab === 'profile' ? (
        <EditProfileForm
          initialDisplayName={profile?.displayName ?? ''}
          initialBio={profile?.bio ?? ''}
          initialAvatar={profile?.avatar ?? ''}
          initialTheme={profile?.preferences?.theme ?? 'light'}
          initialCurrency={profile?.preferences?.defaultCurrency ?? 'USD'}
          initialEmailNotifications={profile?.preferences?.emailNotifications ?? true}
          onSave={updateProfile}
        />
      ) : (
        <div className="space-y-10">
          <ChangePasswordForm onSave={changePassword} />
          <DeleteAccountSection onDelete={deleteAccount} />
        </div>
      )}
    </div>
  );
}

interface EditProfileFormProps {
  initialDisplayName: string;
  initialBio: string;
  initialAvatar: string;
  initialTheme: 'light' | 'dark';
  initialCurrency: string;
  initialEmailNotifications: boolean;
  onSave: (dto: {
    displayName?: string;
    bio?: string;
    avatar?: string;
    preferences?: {
      theme?: 'light' | 'dark';
      defaultCurrency?: string;
      emailNotifications?: boolean;
    };
  }) => Promise<void>;
}

function EditProfileForm({
  initialDisplayName,
  initialBio,
  initialAvatar,
  initialTheme,
  initialCurrency,
  initialEmailNotifications,
  onSave,
}: EditProfileFormProps): React.JSX.Element {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [avatar, setAvatar] = useState(initialAvatar);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [currency, setCurrency] = useState(initialCurrency);
  const [emailNotifications, setEmailNotifications] = useState(initialEmailNotifications);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setLoading(true);
    try {
      await onSave({
        displayName: displayName || undefined,
        bio: bio || undefined,
        avatar: avatar || undefined,
        preferences: { theme, defaultCurrency: currency, emailNotifications },
      });
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className={LABEL}>Display name</label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          maxLength={100}
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL}>Bio</label>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A short bio"
          maxLength={500}
          rows={3}
          className={`${INPUT} resize-none`}
        />
      </div>

      <div>
        <label className={LABEL}>Avatar URL</label>
        <input
          type="url"
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://example.com/avatar.png"
          className={INPUT}
        />
      </div>

      <div className="border-t border-gray-700 pt-5">
        <p className="text-sm font-medium text-gray-300 mb-4">Preferences</p>
        <div className="space-y-4">
          <div>
            <label className={LABEL}>Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
              className={INPUT}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div>
            <label className={LABEL}>Default currency</label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={INPUT}
            >
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white">Email notifications</p>
              <p className="text-xs text-gray-500">Receive price alerts and portfolio updates</p>
            </div>
            <button
              type="button"
              onClick={() => setEmailNotifications((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                emailNotifications ? 'bg-blue-600' : 'bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  emailNotifications ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">Profile saved.</p>}

      <button type="submit" disabled={loading} className={BTN}>
        {loading ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

interface DeleteAccountSectionProps {
  onDelete: (password: string) => Promise<void>;
}

function DeleteAccountSection({ onDelete }: DeleteAccountSectionProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function openModal() {
    setPassword('');
    setError('');
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function closeModal() {
    if (loading) return;
    setOpen(false);
    setPassword('');
    setError('');
  }

  async function handleConfirm() {
    if (!password) {
      setError('Password is required');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await onDelete(password);
      router.replace('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
      setLoading(false);
    }
  }

  return (
    <>
      <div className="border border-red-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-red-400 mb-1">Danger zone</h3>
        <p className="text-sm text-gray-400 mb-4">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Delete account
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-white mb-1">Delete account</h2>
            <p className="text-sm text-gray-400 mb-5">
              Enter your password to confirm. This action is permanent and cannot be reversed.
            </p>

            <label className={LABEL}>Password</label>
            <input
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleConfirm();
                if (e.key === 'Escape') closeModal();
              }}
              placeholder="••••••••"
              className={`${INPUT} mb-4`}
              disabled={loading}
            />

            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={loading || !password}
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface ChangePasswordFormProps {
  onSave: (currentPassword: string, newPassword: string) => Promise<void>;
}

function ChangePasswordForm({ onSave }: ChangePasswordFormProps): React.JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (next.length < 8) {
      setError('New password must be at least 8 characters');
      return;
    }
    if (next !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      await onSave(current, next);
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label htmlFor="current-password" className={LABEL}>
          Current password
        </label>
        <input
          id="current-password"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="••••••••"
          required
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="new-password" className={LABEL}>
          New password
        </label>
        <input
          id="new-password"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="••••••••"
          required
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor="confirm-password" className={LABEL}>
          Confirm new password
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          required
          className={INPUT}
        />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">Password updated.</p>}

      <button type="submit" disabled={loading} className={BTN}>
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
