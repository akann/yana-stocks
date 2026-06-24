'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useAuth } from '@/context/AuthContext';
import type { MFASetupData } from '@/context/AuthContext';

type Tab = 'profile' | 'password' | 'delete';

const INPUT =
  'w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500';
const LABEL = 'block text-sm text-gray-600 mb-1';
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
    getMFAStatus,
    setupMFA,
    enableMFA,
    disableMFA,
  } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('profile');

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace('/login');
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !isAuthenticated) {
    return <div className="animate-pulse bg-gray-100 rounded-xl h-32 m-6" />;
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Account</h1>
        <p className="text-gray-600 text-sm mt-1">{user?.email}</p>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        {(
          [
            { key: 'profile', label: 'Profile' },
            { key: 'password', label: 'Change password' },
            { key: 'delete', label: 'Delete account' },
          ] as { key: Tab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === key
                ? 'border-blue-500 text-gray-900'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          <EditProfileForm
            initialDisplayName={profile?.displayName ?? ''}
            initialBio={profile?.bio ?? ''}
            initialAvatar={profile?.avatar ?? ''}
            initialTheme={profile?.preferences?.theme ?? 'light'}
            initialCurrency={profile?.preferences?.defaultCurrency ?? 'USD'}
            initialEmailNotifications={profile?.preferences?.emailNotifications ?? true}
            onSave={updateProfile}
          />
          <MFASection
            onGetStatus={getMFAStatus}
            onSetup={setupMFA}
            onEnable={enableMFA}
            onDisable={disableMFA}
          />
        </>
      )}
      {tab === 'password' && <ChangePasswordForm onSave={changePassword} />}
      {tab === 'delete' && <DeleteAccountSection onDelete={deleteAccount} />}
    </div>
  );
}

interface MFASectionProps {
  onGetStatus: () => Promise<boolean>;
  onSetup: () => Promise<MFASetupData>;
  onEnable: (code: string) => Promise<void>;
  onDisable: () => Promise<void>;
}

function MFASection({
  onGetStatus,
  onSetup,
  onEnable,
  onDisable,
}: MFASectionProps): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setupData, setSetupData] = useState<MFASetupData | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onGetStatus()
      .then(setEnabled)
      .catch(() => setEnabled(false));
  }, [onGetStatus]);

  useEffect(() => {
    if (!setupData) return;
    QRCode.toDataURL(setupData.otpAuthURL, { width: 200 })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [setupData]);

  async function handleSetup() {
    setError('');
    setLoading(true);
    try {
      setSetupData(await onSetup());
    } catch {
      setError('Failed to generate MFA setup');
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable() {
    setError('');
    setLoading(true);
    try {
      await onEnable(code);
      setEnabled(true);
      setSetupData(null);
      setQrDataUrl('');
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  async function handleDisable() {
    setError('');
    setLoading(true);
    try {
      await onDisable();
      setEnabled(false);
    } catch {
      setError('Failed to disable MFA');
    } finally {
      setLoading(false);
    }
  }

  function cancelSetup() {
    setSetupData(null);
    setQrDataUrl('');
    setCode('');
    setError('');
  }

  return (
    <div className="border-t border-gray-200 pt-5 mt-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-gray-900">Two-factor authentication</p>
          <p className="text-xs text-gray-600 mt-0.5">
            {enabled
              ? 'Your account is protected with TOTP.'
              : 'Add an extra layer of security using an authenticator app.'}
          </p>
        </div>
        {enabled === null ? null : enabled ? (
          <span className="text-xs text-green-600 font-medium">Enabled</span>
        ) : (
          <span className="text-xs text-gray-600">Disabled</span>
        )}
      </div>

      {enabled === null && <div className="animate-pulse bg-gray-100 rounded h-9 w-28" />}

      {enabled === false && !setupData && (
        <button type="button" onClick={() => void handleSetup()} disabled={loading} className={BTN}>
          {loading ? 'Generating…' : 'Set up MFA'}
        </button>
      )}

      {enabled === false && setupData && (
        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            Scan with your authenticator app (Google Authenticator, Authy, etc.).
          </p>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="MFA QR code" className="bg-white p-2 rounded-lg w-48 h-48" />
          )}
          <div>
            <p className="text-xs text-gray-600 mb-1">Or enter this key manually:</p>
            <code className="text-xs text-gray-600 font-mono bg-gray-100 px-2 py-1 rounded break-all block">
              {setupData.secret}
            </code>
          </div>
          <div>
            <label className={LABEL}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="123456"
              className={INPUT}
            />
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => void handleEnable()}
              disabled={loading || code.length !== 6}
              className={BTN}
            >
              {loading ? 'Verifying…' : 'Enable MFA'}
            </button>
            <button
              type="button"
              onClick={cancelSetup}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {enabled === true && (
        <div>
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <button
            type="button"
            onClick={() => void handleDisable()}
            disabled={loading}
            className="bg-gray-200 hover:bg-gray-600 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? 'Disabling…' : 'Disable MFA'}
          </button>
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

      <div className="border-t border-gray-200 pt-5">
        <p className="text-sm font-medium text-gray-600 mb-4">Preferences</p>
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
              <p className="text-sm text-gray-900">Email notifications</p>
              <p className="text-xs text-gray-600">Receive price alerts and portfolio updates</p>
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

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {success && <p className="text-green-600 text-sm">Profile saved.</p>}

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
        <p className="text-sm text-gray-600 mb-6">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <button
          type="button"
          onClick={openModal}
          className="bg-red-700 hover:bg-red-600 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Delete my account
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="bg-[#f2f5f7] border border-gray-200 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Delete account</h2>
            <p className="text-sm text-gray-600 mb-5">
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

            {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeModal}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={loading || !password}
                className="bg-red-700 hover:bg-red-600 text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

      {error && <p className="text-red-600 text-sm">{error}</p>}
      {success && <p className="text-green-600 text-sm">Password updated.</p>}

      <button type="submit" disabled={loading} className={BTN}>
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
