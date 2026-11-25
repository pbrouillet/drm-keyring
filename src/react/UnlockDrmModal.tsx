import React, { useEffect, useMemo, useState } from 'react';
import {
  Cloud,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  RotateCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  MAX_DRM_HINT_LENGTH,
  MIN_DRM_PASSPHRASE_LENGTH,
} from '../constants.js';
import type { DrmManagedKey, DrmProtectedItem } from '../types.js';
import { formatBytes } from '../utils.js';

export interface ApplyBookDrmSubmission {
  authMode: 'managed' | 'passphrase';
  selectedKeyId?: string;
  passphrase: string;
  keyHint: string;
  sealCoverWhenLocked: boolean;
  exportNdrmBackup: boolean;
}

export interface RotateSingleBookDrmSubmission {
  currentPassphrase: string;
  targetMode: 'managed' | 'passphrase';
  targetKeyId?: string;
  targetPassphrase: string;
  targetKeyHint: string;
  deepReencryptPayload: boolean;
  exportNdrmBackup: boolean;
}

export interface UnlockDrmModalProps<TItem extends DrmProtectedItem = DrmProtectedItem> {
  mode: 'unlock' | 'encrypt' | 'rotate';
  book: TItem | null;
  drmKeys?: DrmManagedKey[];
  onUnlock?: (passphrase: string, rememberInRamMinutes: number) => Promise<void>;
  onEncrypt?: (options: ApplyBookDrmSubmission) => Promise<void>;
  onRotate?: (options: RotateSingleBookDrmSubmission) => Promise<void>;
  onOpenKeyVault?: () => void;
  onClose: () => void;
}

export function UnlockDrmModal<TItem extends DrmProtectedItem = DrmProtectedItem>({
  mode,
  book,
  drmKeys = [],
  onUnlock,
  onEncrypt,
  onRotate,
  onOpenKeyVault,
  onClose,
}: UnlockDrmModalProps<TItem>): React.ReactElement | null {
  const activeKeys = useMemo(
    () => drmKeys.filter((k) => k.status === 'active'),
    [drmKeys]
  );

  const defaultActiveKeyId = useMemo(
    () => activeKeys.find((k) => k.isDefault)?.keyId ?? activeKeys[0]?.keyId ?? '',
    [activeKeys]
  );

  const [authMode, setAuthMode] = useState<'managed' | 'passphrase'>('passphrase');
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [targetPassphrase, setTargetPassphrase] = useState('');
  const [confirmTargetPassphrase, setConfirmTargetPassphrase] = useState('');
  const [keyHint, setKeyHint] = useState('');
  const [sealCoverWhenLocked, setSealCoverWhenLocked] = useState(false);
  const [deepReencryptPayload, setDeepReencryptPayload] = useState(false);
  const [exportNdrmBackup, setExportNdrmBackup] = useState(false);
  const [rememberInRam, setRememberInRam] = useState(true);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const preferManaged = activeKeys.length > 0;
    setAuthMode(preferManaged ? 'managed' : 'passphrase');
    setSelectedKeyId(defaultActiveKeyId);
    setPassphrase('');
    setConfirmPassphrase('');
    setTargetPassphrase('');
    setConfirmTargetPassphrase('');
    setKeyHint('');
    setSealCoverWhenLocked(book?.drm?.sealCoverWhenLocked ?? false);
    setDeepReencryptPayload(false);
    setExportNdrmBackup(false);
    setRememberInRam(true);
    setShowPassphrase(false);
    setIsBusy(false);
    setErrorMessage(null);
  }, [activeKeys.length, book?.drm?.sealCoverWhenLocked, book?.id, defaultActiveKeyId, mode]);

  useEffect(() => {
    if (!book) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [book, isBusy, onClose]);

  if (!book) return null;

  const isManagedBook = book.drm?.kekScheme === 'managed-key-v1';
  const boundManagedKey = isManagedBook
    ? drmKeys.find(
        (k) =>
          k.keyId === book.drm?.keyId ||
          (Boolean(book.drm?.keyFingerprint) && k.fingerprint === book.drm?.keyFingerprint)
      ) ?? null
    : null;

  const isSourceKeyMissingOnDevice = isManagedBook && !boundManagedKey;
  const effectiveUnlockHint = boundManagedKey?.keyHint || book.drm?.keyHint;
  const selectedTargetKey = activeKeys.find((k) => k.keyId === selectedKeyId) ?? null;
  const isRotatingToSameManagedKey =
    mode === 'rotate' &&
    authMode === 'managed' &&
    Boolean(boundManagedKey && selectedTargetKey && boundManagedKey.keyId === selectedTargetKey.keyId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (mode === 'unlock') {
      if (isSourceKeyMissingOnDevice) {
        setErrorMessage(
          'The Managed DRM Key bound to this volume is not in this browser keyring yet. Restore your keyring from Google Drive first.'
        );
        return;
      }
      if (!passphrase) {
        setErrorMessage('Enter your passphrase to decrypt this volume in RAM.');
        return;
      }
      if (!onUnlock) return;
      setIsBusy(true);
      try {
        await onUnlock(passphrase, rememberInRam ? 15 : 0);
        setPassphrase('');
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Incorrect passphrase or corrupted encrypted container.'
        );
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (mode === 'encrypt') {
      if (authMode === 'managed') {
        if (!selectedTargetKey) {
          setErrorMessage('Select an active Managed DRM Key or switch to Standalone Passphrase.');
          return;
        }
        if (!passphrase) {
          setErrorMessage(
            `Enter the passphrase for "${selectedTargetKey.label}" to encrypt this volume.`
          );
          return;
        }
        if (!onEncrypt) return;
        setIsBusy(true);
        try {
          await onEncrypt({
            authMode: 'managed',
            selectedKeyId: selectedTargetKey.keyId,
            passphrase,
            keyHint: selectedTargetKey.keyHint ?? '',
            sealCoverWhenLocked,
            exportNdrmBackup,
          });
          setPassphrase('');
        } catch (err) {
          setErrorMessage(
            err instanceof Error ? err.message : 'Failed to encrypt volume with Managed DRM Key.'
          );
        } finally {
          setIsBusy(false);
        }
        return;
      }

      if (passphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
        setErrorMessage(
          `Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
        );
        return;
      }
      if (passphrase !== confirmPassphrase) {
        setErrorMessage('Passphrase confirmation does not match.');
        return;
      }
      if (
        keyHint.trim() &&
        keyHint.trim().toLowerCase() === passphrase.trim().toLowerCase()
      ) {
        setErrorMessage('Never enter your actual passphrase inside the optional hint field.');
        return;
      }
      if (!onEncrypt) return;

      setIsBusy(true);
      try {
        await onEncrypt({
          authMode: 'passphrase',
          passphrase,
          keyHint: keyHint.trim().slice(0, MAX_DRM_HINT_LENGTH),
          sealCoverWhenLocked,
          exportNdrmBackup,
        });
        setPassphrase('');
        setConfirmPassphrase('');
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to encrypt volume with Personal DRM.'
        );
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (isSourceKeyMissingOnDevice) {
      setErrorMessage(
        'Restore the source Managed DRM Key from Google Drive before rotating this volume.'
      );
      return;
    }
    if (!passphrase) {
      setErrorMessage('Enter the current passphrase to authorize key rotation.');
      return;
    }

    if (authMode === 'managed') {
      if (!selectedTargetKey) {
        setErrorMessage('Select a target Managed DRM Key or switch to Standalone Passphrase.');
        return;
      }
      const effectiveTargetPass = isRotatingToSameManagedKey ? passphrase : targetPassphrase;
      if (!effectiveTargetPass) {
        setErrorMessage(`Enter the passphrase for target key "${selectedTargetKey.label}".`);
        return;
      }
      if (!onRotate) return;

      setIsBusy(true);
      try {
        await onRotate({
          currentPassphrase: passphrase,
          targetMode: 'managed',
          targetKeyId: selectedTargetKey.keyId,
          targetPassphrase: effectiveTargetPass,
          targetKeyHint: selectedTargetKey.keyHint ?? '',
          deepReencryptPayload: deepReencryptPayload || isRotatingToSameManagedKey,
          exportNdrmBackup,
        });
        setPassphrase('');
        setTargetPassphrase('');
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to rotate volume DRM key.');
      } finally {
        setIsBusy(false);
      }
      return;
    }

    if (targetPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      setErrorMessage(
        `New passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
      );
      return;
    }
    if (targetPassphrase !== confirmTargetPassphrase) {
      setErrorMessage('New passphrase confirmation does not match.');
      return;
    }
    if (
      keyHint.trim() &&
      keyHint.trim().toLowerCase() === targetPassphrase.trim().toLowerCase()
    ) {
      setErrorMessage('Never enter your actual passphrase inside the optional hint field.');
      return;
    }
    if (!onRotate) return;

    setIsBusy(true);
    try {
      await onRotate({
        currentPassphrase: passphrase,
        targetMode: 'passphrase',
        targetPassphrase,
        targetKeyHint: keyHint.trim().slice(0, MAX_DRM_HINT_LENGTH),
        deepReencryptPayload,
        exportNdrmBackup,
      });
      setPassphrase('');
      setTargetPassphrase('');
      setConfirmTargetPassphrase('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to rotate volume DRM key.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="personal-drm-modal-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => {
        if (!isBusy) onClose();
      }}
    >
      <div
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:max-h-[92vh] sm:rounded-2xl sm:p-6 dark:border-[#242D42] dark:bg-[#121620]"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
          aria-hidden="true"
        />
        <div className="flex items-start justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E5A93C]/15 text-[#C5841A] dark:text-[#E5A93C]">
              {mode === 'unlock' ? (
                <KeyRound className="h-5 w-5" aria-hidden="true" />
              ) : mode === 'rotate' ? (
                <RotateCw className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Lock className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="personal-drm-modal-title"
                className="font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]"
              >
                {mode === 'unlock'
                  ? 'Unlock Personal DRM Volume'
                  : mode === 'rotate'
                  ? 'Rotate Volume DRM Key'
                  : 'Encrypt Volume with Personal DRM'}
              </h2>
              <p className="mt-0.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {book.title} · {book.format} · {formatBytes(book.sizeBytes)}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Close dialog"
            className="flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          {(mode === 'unlock' || mode === 'rotate') && isManagedBook && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-[#1E2536] dark:bg-[#0D1018]">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  {boundManagedKey?.label || book.drm?.keyLabel || 'Managed Vault Key'}
                  {boundManagedKey ? ` · v${boundManagedKey.generation}` : ''}
                </span>
                <span className="break-all font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {boundManagedKey?.fingerprint || book.drm?.keyFingerprint || book.drm?.keyId}
                </span>
              </div>

              {isSourceKeyMissingOnDevice ? (
                <div className="mt-2 space-y-2 border-t border-slate-200 pt-2 dark:border-[#1E2536]">
                  <p className="text-amber-800 dark:text-amber-300">
                    This Managed DRM Key is not in this browser&apos;s local keyring yet. Restore
                    your encrypted keyring from Google Drive or import a{' '}
                    <code className="font-mono">.nkey.json</code> backup.
                  </p>
                  {onOpenKeyVault && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenKeyVault();
                      }}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#E5A93C] px-3 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[34px] whitespace-nowrap shrink-0"
                    >
                      <Cloud className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Open DRM Key Vault &amp; Restore</span>
                    </button>
                  )}
                </div>
              ) : (
                boundManagedKey?.status === 'retired' && (
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Retired key generation — unlocks normally in RAM; consider rotating this volume
                    to your active default key.
                  </p>
                )
              )}
            </div>
          )}

          {mode === 'unlock' && effectiveUnlockHint && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-[#1E2536] dark:bg-[#0D1018] dark:text-slate-300">
              <span className="font-medium text-slate-900 dark:text-[#E8ECF4]">
                Passphrase hint:
              </span>{' '}
              {effectiveUnlockHint}
            </p>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2.5 text-xs text-red-700 dark:text-red-300"
            >
              {errorMessage}
            </div>
          )}

          {mode === 'encrypt' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Encryption Key Mode
                </span>
                {onOpenKeyVault && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenKeyVault();
                    }}
                    className="text-xs font-semibold text-[#C5841A] hover:underline dark:text-[#E5A93C] whitespace-nowrap"
                  >
                    Manage Keys ({activeKeys.length})
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-[#0D1018]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('managed');
                    if (!selectedKeyId && defaultActiveKeyId) {
                      setSelectedKeyId(defaultActiveKeyId);
                    }
                  }}
                  className={`min-h-[40px] truncate rounded-md px-2 py-1 text-xs font-medium transition-colors sm:min-h-[34px] sm:px-2.5 ${
                    authMode === 'managed'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
                  }`}
                >
                  Managed Vault Key
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('passphrase')}
                  className={`min-h-[40px] truncate rounded-md px-2 py-1 text-xs font-medium transition-colors sm:min-h-[34px] sm:px-2.5 ${
                    authMode === 'passphrase'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
                  }`}
                >
                  Standalone Passphrase
                </button>
              </div>

              {authMode === 'managed' &&
                (activeKeys.length === 0 ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:border-[#1E2536] dark:bg-[#0D1018] dark:text-slate-400">
                    No active Managed DRM Keys exist yet. Create one in the DRM Key Vault to enable
                    instant key rotation and Google Drive keyring backup, or use a Standalone
                    Passphrase.
                  </div>
                ) : (
                  <div>
                    <label
                      htmlFor="drm-modal-key-select"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Active Managed Key
                    </label>
                    <select
                      id="drm-modal-key-select"
                      value={selectedKeyId}
                      onChange={(e) => setSelectedKeyId(e.target.value)}
                      className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    >
                      {activeKeys.map((k) => (
                        <option key={k.keyId} value={k.keyId}>
                          {k.label} · v{k.generation} · {k.fingerprint}
                          {k.isDefault ? ' (Default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
            </div>
          )}

          {!(mode === 'encrypt' && authMode === 'managed' && activeKeys.length === 0) && (
            <div>
              <label
                htmlFor="drm-modal-passphrase"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                {mode === 'unlock'
                  ? isManagedBook
                    ? 'Key Passphrase'
                    : 'Passphrase'
                  : mode === 'rotate'
                  ? isManagedBook
                    ? `Current Key Passphrase (${boundManagedKey?.label || book.drm?.keyLabel || 'Source Key'})`
                    : 'Current Volume Passphrase'
                  : authMode === 'managed'
                  ? `Passphrase for "${selectedTargetKey?.label ?? 'Selected Key'}"`
                  : `Create Passphrase (min ${MIN_DRM_PASSPHRASE_LENGTH} characters)`}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="drm-modal-passphrase"
                  type={showPassphrase ? 'text' : 'password'}
                  autoFocus
                  autoComplete={
                    mode === 'encrypt' && authMode === 'passphrase'
                      ? 'new-password'
                      : 'current-password'
                  }
                  disabled={isBusy || isSourceKeyMissingOnDevice}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={
                    mode === 'unlock'
                      ? 'Enter passphrase to decrypt in RAM...'
                      : mode === 'rotate'
                      ? 'Enter current passphrase to unwrap DEK...'
                      : authMode === 'managed'
                      ? 'Authorize Managed DRM Key...'
                      : 'Choose a strong passphrase...'
                  }
                  className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none disabled:opacity-50 sm:min-h-[42px] dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassphrase((s) => !s)}
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 sm:right-2 sm:h-8 sm:w-8 dark:hover:text-slate-200"
                >
                  {showPassphrase ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
          )}

          {mode === 'encrypt' && authMode === 'passphrase' && (
            <>
              <div>
                <label
                  htmlFor="drm-modal-confirm"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm Passphrase
                </label>
                <input
                  id="drm-modal-confirm"
                  type={showPassphrase ? 'text' : 'password'}
                  autoComplete="new-password"
                  disabled={isBusy}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter passphrase..."
                  className="mt-1.5 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div>
                <label
                  htmlFor="drm-modal-hint"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Optional Non-Secret Hint
                </label>
                <input
                  id="drm-modal-hint"
                  type="text"
                  maxLength={MAX_DRM_HINT_LENGTH}
                  disabled={isBusy}
                  value={keyHint}
                  onChange={(e) => setKeyHint(e.target.value)}
                  placeholder="Optional reminder (never write the passphrase itself)"
                  className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>
            </>
          )}

          {mode === 'rotate' && !isSourceKeyMissingOnDevice && (
            <div className="space-y-3 border-t border-slate-100 pt-3.5 dark:border-[#1E2536]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Rotate Volume To
                </span>
                {onOpenKeyVault && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenKeyVault();
                    }}
                    className="text-xs font-semibold text-[#C5841A] hover:underline dark:text-[#E5A93C] whitespace-nowrap"
                  >
                    Open Key Vault
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1 dark:bg-[#0D1018]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('managed');
                    if (!selectedKeyId && defaultActiveKeyId) {
                      setSelectedKeyId(defaultActiveKeyId);
                    }
                  }}
                  className={`min-h-[40px] truncate rounded-md px-2 py-1 text-xs font-medium transition-colors sm:min-h-[34px] sm:px-2.5 ${
                    authMode === 'managed'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
                  }`}
                >
                  Managed Vault Key
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('passphrase')}
                  className={`min-h-[40px] truncate rounded-md px-2 py-1 text-xs font-medium transition-colors sm:min-h-[34px] sm:px-2.5 ${
                    authMode === 'passphrase'
                      ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
                  }`}
                >
                  New Passphrase
                </button>
              </div>

              {authMode === 'managed' ? (
                activeKeys.length === 0 ? (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-[#0D1018] dark:text-slate-400">
                    No active Managed DRM Keys found. Create one in Key Vault or rotate to a New
                    Passphrase.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="drm-rotate-target-key"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Target Managed Key
                      </label>
                      <select
                        id="drm-rotate-target-key"
                        value={selectedKeyId}
                        onChange={(e) => setSelectedKeyId(e.target.value)}
                        className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                      >
                        {activeKeys.map((k) => (
                          <option key={k.keyId} value={k.keyId}>
                            {k.label} · v{k.generation} · {k.fingerprint}
                            {k.isDefault ? ' (Default)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {isRotatingToSameManagedKey ? (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Re-keying onto the same Managed Key generates a fresh random 256-bit DEK and
                        re-encrypts the archive ciphertext in RAM.
                      </p>
                    ) : (
                      <div>
                        <label
                          htmlFor="drm-rotate-target-key-pass"
                          className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                        >
                          Target Key Passphrase ({selectedTargetKey?.label ?? 'Selected Key'})
                        </label>
                        <input
                          id="drm-rotate-target-key-pass"
                          type={showPassphrase ? 'text' : 'password'}
                          autoComplete="current-password"
                          disabled={isBusy}
                          value={targetPassphrase}
                          onChange={(e) => setTargetPassphrase(e.target.value)}
                          placeholder="Enter target Managed Key passphrase..."
                          className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                        />
                      </div>
                    )}
                  </div>
                )
              ) : (
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="drm-rotate-new-pass"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      New Passphrase (min {MIN_DRM_PASSPHRASE_LENGTH} chars)
                    </label>
                    <input
                      id="drm-rotate-new-pass"
                      type={showPassphrase ? 'text' : 'password'}
                      autoComplete="new-password"
                      disabled={isBusy}
                      value={targetPassphrase}
                      onChange={(e) => setTargetPassphrase(e.target.value)}
                      placeholder="Choose new volume passphrase..."
                      className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="drm-rotate-confirm-pass"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Confirm New Passphrase
                    </label>
                    <input
                      id="drm-rotate-confirm-pass"
                      type={showPassphrase ? 'text' : 'password'}
                      autoComplete="new-password"
                      disabled={isBusy}
                      value={confirmTargetPassphrase}
                      onChange={(e) => setConfirmTargetPassphrase(e.target.value)}
                      placeholder="Re-enter new passphrase..."
                      className="mt-1.5 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="drm-rotate-hint"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Optional Non-Secret Hint
                    </label>
                    <input
                      id="drm-rotate-hint"
                      type="text"
                      maxLength={MAX_DRM_HINT_LENGTH}
                      disabled={isBusy}
                      value={keyHint}
                      onChange={(e) => setKeyHint(e.target.value)}
                      placeholder="Optional memory cue..."
                      className="mt-1.5 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2 border-t border-slate-100 pt-3 dark:border-[#1E2536]">
                {!isRotatingToSameManagedKey && (
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={deepReencryptPayload}
                      onChange={(e) => setDeepReencryptPayload(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                    />
                    <span>
                      Deep re-key archive payload (generate new 256-bit DEK and re-encrypt full
                      ciphertext in RAM)
                    </span>
                  </label>
                )}

                <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={exportNdrmBackup}
                    onChange={(e) => setExportNdrmBackup(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                  />
                  <span>
                    Download updated <code className="font-mono">.ndrm</code> encrypted container
                    backup
                  </span>
                </label>
              </div>
            </div>
          )}

          {mode === 'encrypt' && (
            <div className="space-y-2.5 border-t border-slate-100 pt-3 dark:border-[#1E2536]">
              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={sealCoverWhenLocked}
                  onChange={(e) => setSealCoverWhenLocked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                />
                <span>
                  Clear cached cover now (re-caches locally when unlocked &amp; opened)
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={exportNdrmBackup}
                  onChange={(e) => setExportNdrmBackup(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                />
                <span>
                  Also download portable <code className="font-mono">.ndrm</code> encrypted
                  container backup
                </span>
              </label>
            </div>
          )}

          {mode === 'unlock' && !isSourceKeyMissingOnDevice && (
            <label className="flex cursor-pointer items-start gap-2.5 border-t border-slate-100 pt-3 text-xs text-slate-700 dark:border-[#1E2536] dark:text-slate-300">
              <input
                type="checkbox"
                checked={rememberInRam}
                onChange={(e) => setRememberInRam(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
              />
              <span>
                Keep keyring unlocked in RAM for 15 minutes after closing a book (auto-locks after
                15m idle or when tab closes; never saved to storage)
              </span>
            </label>
          )}

          <div className="flex items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-600 dark:bg-[#0D1018] dark:text-slate-400">
            <ShieldCheck
              className="mt-0.5 h-4 w-4 shrink-0 text-[#C5841A] dark:text-[#E5A93C]"
              aria-hidden="true"
            />
            <span>
              {mode === 'unlock'
                ? 'Protected with PBKDF2-SHA256 (210k iterations) + AES-256-GCM. Decrypted bytes stay strictly in RAM and are zeroed when you exit the reader.'
                : mode === 'rotate'
                ? 'Re-wraps the volume Data-Encryption Key in volatile RAM and zeroes all raw key buffers immediately without writing plaintext to disk.'
                : 'Replaces the plaintext archive in IndexedDB with AES-256-GCM ciphertext. Back up Managed Keys to Google Drive so you can recover volumes on any device.'}
            </span>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end sm:gap-2.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={onClose}
              className="min-h-[44px] w-full rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[40px] sm:w-auto dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                isBusy ||
                isSourceKeyMissingOnDevice ||
                (mode !== 'unlock' && authMode === 'managed' && activeKeys.length === 0)
              }
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] sm:w-auto whitespace-nowrap shrink-0"
            >
              {isBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>
                    {mode === 'unlock'
                      ? 'Decrypting in RAM...'
                      : mode === 'rotate'
                      ? 'Rotating Key...'
                      : 'Encrypting Archive...'}
                  </span>
                </>
              ) : mode === 'rotate' ? (
                <>
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Rotate Key</span>
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{mode === 'unlock' ? 'Unlock & Read' : 'Encrypt Volume'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
