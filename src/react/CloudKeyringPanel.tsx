import React, { useEffect, useState } from 'react';
import {
  Cloud,
  Download,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  RefreshCw,
  Shield,
  Trash2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_KEYRING_FILENAME,
  MIN_DRM_PASSPHRASE_LENGTH,
} from '../constants.js';
import type { DrmManagedKey, RemoteKeyringSummary } from '../types.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';

export interface CloudKeyringPanelProps {
  isDriveConnected: boolean;
  isDriveSessionLive?: boolean;
  isOptedIn: boolean;
  isSessionUnlocked: boolean;
  isSyncingKeyring: boolean;
  isInspectingRemote: boolean;
  cloudKeyringError: string | null;
  lastKeyringSyncedAt: number;
  localKeys: DrmManagedKey[];
  remoteSummary: RemoteKeyringSummary | null;
  cloudKeyringHint?: string;
  providerLabel?: string;
  remoteFileName?: string;
  renderConnectButton?: () => React.ReactNode;
  onConnectDrive: () => void;
  onRefreshRemoteStatus: () => Promise<void>;
  onEnableAndUnlock: (options: {
    masterPassphrase: string;
    backupHint?: string;
    forceOverwriteRemote?: boolean;
  }) => Promise<{ mergedCount: number; pushed: boolean }>;
  onSyncKeyringNow: () => Promise<{ mergedCount: number; pushed: boolean }>;
  onRotateMasterPassphrase: (options: {
    newMasterPassphrase: string;
    newHint?: string;
  }) => Promise<void>;
  onLockSession: () => void;
  onDisableCloudKeyring: (deleteRemoteFile: boolean) => Promise<void>;
  onOpenDrmKeyVault?: () => void;
  onOpenExportWizard?: () => void;
  onOpenImportWizard?: () => void;
}

export const CloudKeyringPanel: React.FC<CloudKeyringPanelProps> = ({
  isDriveConnected,
  isDriveSessionLive = isDriveConnected,
  isOptedIn,
  isSessionUnlocked,
  isSyncingKeyring,
  isInspectingRemote,
  cloudKeyringError,
  lastKeyringSyncedAt,
  localKeys,
  remoteSummary,
  cloudKeyringHint,
  providerLabel = 'Google Drive',
  remoteFileName = DEFAULT_KEYRING_FILENAME,
  renderConnectButton,
  onConnectDrive,
  onRefreshRemoteStatus,
  onEnableAndUnlock,
  onSyncKeyringNow,
  onRotateMasterPassphrase,
  onLockSession,
  onDisableCloudKeyring,
  onOpenDrmKeyVault,
  onOpenExportWizard,
  onOpenImportWizard,
}) => {
  const [specDialogOpen, setSpecDialogOpen] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [resetRemoteMode, setResetRemoteMode] = useState(false);

  const [masterPassphrase, setMasterPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [hintInput, setHintInput] = useState(cloudKeyringHint ?? '');
  const [showPassphrase, setShowPassphrase] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [confirmDisableDeleteOpen, setConfirmDisableDeleteOpen] = useState(false);

  useEffect(() => {
    if (!specDialogOpen && !rotateDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        setSpecDialogOpen(false);
        setRotateDialogOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [specDialogOpen, rotateDialogOpen, isSubmitting]);

  const effectiveHint =
    remoteSummary?.header?.backupHint || cloudKeyringHint || undefined;

  const requiresNewPassphraseConfirmation =
    !remoteSummary || resetRemoteMode || rotateDialogOpen;

  const clearPassphraseInputs = () => {
    setMasterPassphrase('');
    setConfirmPassphrase('');
    setShowPassphrase(false);
  };

  const connectButtonNode = renderConnectButton ? (
    renderConnectButton()
  ) : (
    <button
      type="button"
      onClick={onConnectDrive}
      className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-[#283248] dark:bg-[#121620] dark:text-slate-100 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0"
    >
      <Cloud className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
      <span>Connect {providerLabel}</span>
    </button>
  );

  const executeEnableOrUnlock = async (forceOverwrite: boolean) => {
    setFormError(null);
    setStatusNotice(null);

    if (!masterPassphrase) {
      setFormError('Enter your Cloud Keyring Master Passphrase.');
      return;
    }

    if ((!remoteSummary || forceOverwrite) && masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      setFormError(
        `Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
      );
      return;
    }

    if (!remoteSummary || forceOverwrite) {
      if (masterPassphrase !== confirmPassphrase) {
        setFormError('Master Passphrase confirmation does not match.');
        return;
      }
      const trimmedHint = hintInput.trim();
      if (trimmedHint && trimmedHint.toLowerCase() === masterPassphrase.trim().toLowerCase()) {
        setFormError('Never type your Master Passphrase inside the optional hint field.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const result = await onEnableAndUnlock({
        masterPassphrase,
        backupHint: !remoteSummary || forceOverwrite ? hintInput.trim() : undefined,
        forceOverwriteRemote: forceOverwrite,
      });
      clearPassphraseInputs();
      setSetupExpanded(false);
      setResetRemoteMode(false);
      setStatusNotice(
        result.pushed
          ? `Cloud Keyring session unlocked (${result.mergedCount} ${
              result.mergedCount === 1 ? 'key' : 'keys'
            } synchronized via E2EE).`
          : 'Cloud Keyring session armed. Create a DRM key in the Vault to push your first encrypted keyring.'
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Unable to unlock Cloud Keyring session.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitUnlockForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (remoteSummary && resetRemoteMode) {
      if (!masterPassphrase || masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
        setFormError(
          `New Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
        );
        return;
      }
      if (masterPassphrase !== confirmPassphrase) {
        setFormError('Master Passphrase confirmation does not match.');
        return;
      }
      setConfirmOverwriteOpen(true);
      return;
    }
    void executeEnableOrUnlock(false);
  };

  const handleSubmitRotatePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusNotice(null);

    if (!masterPassphrase || masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      setFormError(
        `New Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
      );
      return;
    }
    if (masterPassphrase !== confirmPassphrase) {
      setFormError('New Master Passphrase confirmation does not match.');
      return;
    }
    const trimmedHint = hintInput.trim();
    if (trimmedHint && trimmedHint.toLowerCase() === masterPassphrase.trim().toLowerCase()) {
      setFormError('Never type your Master Passphrase inside the optional hint field.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onRotateMasterPassphrase({
        newMasterPassphrase: masterPassphrase,
        newHint: trimmedHint,
      });
      clearPassphraseInputs();
      setRotateDialogOpen(false);
      setStatusNotice(
        'Rotated Cloud Keyring Master Passphrase with a fresh 128-bit PBKDF2 salt and re-sealed appDataFolder.'
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to rotate Cloud Keyring Master Passphrase.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSync = async () => {
    setFormError(null);
    setStatusNotice(null);
    try {
      const res = await onSyncKeyringNow();
      setStatusNotice(
        res.pushed
          ? `Synchronized ${res.mergedCount} ${
              res.mergedCount === 1 ? 'managed key' : 'managed keys'
            } with ${providerLabel} appDataFolder.`
          : 'Cloud Keyring checked — no keys to push yet.'
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Cloud Keyring sync failed.');
    }
  };

  const statusHeadline = !isOptedIn
    ? 'Opted Out · Local IndexedDB'
    : isSyncingKeyring
    ? 'Opted In · Encrypting & Syncing...'
    : isSessionUnlocked
    ? 'Opted In · Session Unlocked'
    : 'Opted In · Session Locked';

  return (
    <div className="space-y-4">
      {/* Unified Keyring Action Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 lg:flex-row lg:items-center lg:justify-between dark:border-[#1E2536] dark:bg-[#121620]">
        <div className="flex min-w-0 items-center gap-2.5">
          {isOptedIn && isSessionUnlocked ? (
            <Unlock className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <Lock className="h-4 w-4 shrink-0 text-[#E5A93C]" aria-hidden="true" />
          )}
          <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums">
            <span className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
              {statusHeadline}
            </span>
            <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">·</span>
            <span className="text-slate-500 dark:text-slate-400">
              {localKeys.length} local {localKeys.length === 1 ? 'key' : 'keys'}
            </span>
            {lastKeyringSyncedAt > 0 && (
              <>
                <span className="text-slate-400 dark:text-slate-600" aria-hidden="true">·</span>
                <span className="text-slate-500 dark:text-slate-400">
                  Synced{' '}
                  {new Date(lastKeyringSyncedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onOpenExportWizard && (
            <button
              type="button"
              onClick={onOpenExportWizard}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
              <span>Export .nkey</span>
            </button>
          )}

          {onOpenImportWizard && (
            <button
              type="button"
              onClick={onOpenImportWizard}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
            >
              <Upload className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
              <span>Import / Recover</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setSpecDialogOpen(true)}
            className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
          >
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            <span>E2EE Spec</span>
          </button>

          {onOpenDrmKeyVault && (
            <button
              type="button"
              onClick={onOpenDrmKeyVault}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[36px] whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Open Key Vault</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Cloud Keyring E2EE Sync Surface */}
      <section
        aria-labelledby="cloud-keyring-heading"
        className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-2.5">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-[#E5A93C]" aria-hidden="true" />
            <div className="min-w-0">
              <h2
                id="cloud-keyring-heading"
                className="font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]"
              >
                Zero-Knowledge {providerLabel} Keyring Sync
              </h2>
              <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                Synchronize your Managed DRM Keyring across devices using an end-to-end encrypted
                vault. Your Master Passphrase is never stored locally or in the cloud.
              </p>
            </div>
          </div>

          {isDriveConnected ? (
            <button
              type="button"
              disabled={isInspectingRemote || isSyncingKeyring}
              onClick={() => void onRefreshRemoteStatus()}
              className="inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:w-auto dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isInspectingRemote ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isInspectingRemote ? 'Checking...' : 'Check Drive'}</span>
            </button>
          ) : (
            <div className="shrink-0">{connectButtonNode}</div>
          )}
        </div>

        {/* Remote Google Drive appDataFolder Metadata Strip */}
        <div className="border-y border-slate-100 py-3.5 text-xs dark:border-[#1B2130]">
          <div className="font-medium text-slate-700 dark:text-slate-300">
            Remote <span className="font-mono">appDataFolder</span> Bundle
          </div>
          {!isDriveConnected ? (
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              Connect {providerLabel} to inspect or synchronize your encrypted Cloud Keyring.
            </p>
          ) : remoteSummary ? (
            <p className="mt-1 font-mono text-slate-600 dark:text-slate-400 tabular-nums">
              {remoteSummary.header?.keyCount ?? 0}{' '}
              {(remoteSummary.header?.keyCount ?? 0) === 1 ? 'encrypted key' : 'encrypted keys'} ·
              Updated {new Date(remoteSummary.modifiedTime).toLocaleString()} ·{' '}
              {Math.max(1, Math.round(remoteSummary.sizeBytes / 1024))} KB
              {remoteSummary.header?.keyFingerprints?.length
                ? ` · ${remoteSummary.header.keyFingerprints.slice(0, 2).join(', ')}${
                    remoteSummary.header.keyFingerprints.length > 2
                      ? ` +${remoteSummary.header.keyFingerprints.length - 2}`
                      : ''
                  }`
                : ''}
            </p>
          ) : !isDriveSessionLive ? (
            <p className="mt-1 font-mono text-slate-500 dark:text-slate-400">
              {providerLabel} ready on demand · Click Check Drive or unlock below to inspect appDataFolder.
            </p>
          ) : (
            <p className="mt-1 font-mono text-slate-500 dark:text-slate-400">
              No encrypted Cloud Keyring bundle stored in {providerLabel} yet.
            </p>
          )}
          {effectiveHint && (
            <p className="mt-1 text-slate-500 dark:text-slate-400">
              Passphrase hint: <span className="font-medium text-slate-700 dark:text-slate-300">{effectiveHint}</span>
            </p>
          )}
        </div>

        {(cloudKeyringError || formError) && !rotateDialogOpen && (
          <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
            {formError || cloudKeyringError}
          </p>
        )}

        {statusNotice && (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            {statusNotice}
          </p>
        )}

        {/* STATE 1: OPTED OUT */}
        {!isOptedIn && !setupExpanded && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              DRM keys currently remain solely inside this browser&apos;s IndexedDB. Opt in to keep
              keys synchronized across devices using your Master Passphrase.
            </p>
            <button
              type="button"
              onClick={() => {
                setFormError(null);
                setStatusNotice(null);
                setSetupExpanded(true);
              }}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[40px] sm:w-auto whitespace-nowrap shrink-0"
            >
              <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Enable Cloud Keyring</span>
            </button>
          </div>
        )}

        {/* STATE 2: ENABLE SETUP OR LOCKED SESSION UNLOCK FORM */}
        {((!isOptedIn && setupExpanded) || (isOptedIn && !isSessionUnlocked)) && (
          <div className="space-y-4 pt-1">
            {!isDriveConnected ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]">
                    Connect {providerLabel} to Unlock Cloud Keyring
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Cloud Keyring reads and writes the encrypted bundle inside your private{' '}
                    {providerLabel} <span className="font-mono">appDataFolder</span>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {connectButtonNode}
                  {!isOptedIn && (
                    <button
                      type="button"
                      onClick={() => setSetupExpanded(false)}
                      className="min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232]"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitUnlockForm} className="space-y-3.5">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]">
                    {remoteSummary && !resetRemoteMode
                      ? 'Enter Master Passphrase to Unlock & Merge Cloud Keyring'
                      : remoteSummary && resetRemoteMode
                      ? 'Create New Master Passphrase (Overwrites Remote Cloud Keyring)'
                      : 'Set Master Passphrase to Initialize Cloud Keyring'}
                  </div>

                  {remoteSummary && (
                    <button
                      type="button"
                      onClick={() => {
                        setResetRemoteMode((v) => !v);
                        setFormError(null);
                        clearPassphraseInputs();
                      }}
                      className="self-start text-xs font-medium text-[#C5841A] underline-offset-2 hover:underline sm:self-auto dark:text-[#E5A93C]"
                    >
                      {resetRemoteMode
                        ? 'Unlock existing remote keyring instead'
                        : 'Forgot passphrase? Reset remote keyring'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="cloud-keyring-master-pass"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Master Passphrase (never stored)
                    </label>
                    <div className="relative mt-1">
                      <input
                        id="cloud-keyring-master-pass"
                        type={showPassphrase ? 'text' : 'password'}
                        autoComplete="off"
                        value={masterPassphrase}
                        onChange={(e) => setMasterPassphrase(e.target.value)}
                        placeholder={
                          remoteSummary && !resetRemoteMode
                            ? 'Enter existing Master Passphrase'
                            : `At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`
                        }
                        className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassphrase((v) => !v)}
                        aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                      >
                        {showPassphrase ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {requiresNewPassphraseConfirmation ? (
                    <div>
                      <label
                        htmlFor="cloud-keyring-confirm-pass"
                        className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                      >
                        Confirm Master Passphrase
                      </label>
                      <input
                        id="cloud-keyring-confirm-pass"
                        type={showPassphrase ? 'text' : 'password'}
                        autoComplete="off"
                        value={confirmPassphrase}
                        onChange={(e) => setConfirmPassphrase(e.target.value)}
                        placeholder="Re-enter Master Passphrase"
                        className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col justify-end">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Derives a non-extractable session key in RAM, decrypts &amp; merges remote
                        keys, and auto-syncs keyring changes until you lock or close the app.
                      </p>
                    </div>
                  )}
                </div>

                {requiresNewPassphraseConfirmation && (
                  <div>
                    <label
                      htmlFor="cloud-keyring-hint"
                      className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                    >
                      Optional Non-Secret Memory Hint
                    </label>
                    <input
                      id="cloud-keyring-hint"
                      type="text"
                      maxLength={80}
                      value={hintInput}
                      onChange={(e) => setHintInput(e.target.value)}
                      placeholder="e.g., Studio brass notebook phrase (never write your passphrase)"
                      className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-slate-100 pt-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-[#1B2130]">
                  <div className="flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center">
                    <button
                      type="submit"
                      disabled={isSubmitting || isSyncingKeyring}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap"
                    >
                      <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {isSubmitting
                          ? 'Deriving Key & Syncing...'
                          : remoteSummary && !resetRemoteMode
                          ? 'Unlock Session & Merge Keys'
                          : resetRemoteMode
                          ? 'Overwrite & Seal New Keyring'
                          : 'Initialize & Unlock Keyring'}
                      </span>
                    </button>

                    {!isOptedIn && (
                      <button
                        type="button"
                        onClick={() => {
                          setSetupExpanded(false);
                          setResetRemoteMode(false);
                          setFormError(null);
                          clearPassphraseInputs();
                        }}
                        className="min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232]"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {isOptedIn && (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void onDisableCloudKeyring(false)}
                        className="min-h-[44px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap"
                      >
                        Opt Out on Device
                      </button>
                      {remoteSummary && (
                        <button
                          type="button"
                          onClick={() => setConfirmDisableDeleteOpen(true)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 sm:min-h-[38px] dark:text-red-400 whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Delete Cloud File</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </form>
            )}
          </div>
        )}

        {/* STATE 3: OPTED IN & SESSION UNLOCKED */}
        {isOptedIn && isSessionUnlocked && (
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:items-center">
              <button
                type="button"
                disabled={isSyncingKeyring || !isDriveConnected}
                onClick={() => void handleManualSync()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isSyncingKeyring ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{isSyncingKeyring ? 'Syncing Keyring...' : 'Sync Keyring Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormError(null);
                  clearPassphraseInputs();
                  setRotateDialogOpen(true);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
              >
                <KeyRound className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
                <span>Rotate Passphrase</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onLockSession();
                  setRotateDialogOpen(false);
                  setStatusNotice('Locked Cloud Keyring session and cleared volatile CryptoKey.');
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
              >
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Lock Session</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onDisableCloudKeyring(false)}
                className="min-h-[44px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap"
              >
                Opt Out
              </button>
              {remoteSummary && (
                <button
                  type="button"
                  onClick={() => setConfirmDisableDeleteOpen(true)}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 sm:min-h-[38px] dark:text-red-400 whitespace-nowrap"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Delete Cloud Keyring</span>
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Dialog: E2EE Architecture Specification */}
      {specDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="e2ee-spec-dialog-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setSpecDialogOpen(false)}
        >
          <div
            className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-xl sm:p-6 dark:border-[#242C3F] dark:bg-[#121620]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5 dark:border-[#1E2536]">
              <div>
                <h2
                  id="e2ee-spec-dialog-title"
                  className="font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]"
                >
                  Zero-Knowledge Cloud Keyring Architecture
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  End-to-end encryption protocol for cross-device DRM key portability
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSpecDialogOpen(false)}
                aria-label="Close E2EE specification"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-4 divide-y divide-slate-100 text-xs text-slate-700 dark:divide-[#1B2130] dark:text-slate-300">
              <div className="py-3">
                <div className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  01. Zero-Stored-Passphrase KDF
                </div>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                  Your Master Passphrase derives a 256-bit AES-GCM Web Crypto key via{' '}
                  <span className="font-mono">PBKDF2-SHA256</span> (210,000 iterations, 128-bit
                  CSPRNG salt) with <span className="font-mono">extractable: false</span>, then
                  immediately zeroes passphrase bytes in RAM.
                </p>
              </div>
              <div className="py-3">
                <div className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  02. Double-Layer Envelope Sealing
                </div>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                  Individual Managed Keys remain wrapped under their own KEKs inside an outer{' '}
                  <span className="font-mono">AES-256-GCM</span> vault with a fresh 96-bit random IV
                  and canonical header AAD on every push.
                </p>
              </div>
              <div className="py-3">
                <div className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  03. Isolated Drive Storage
                </div>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                  Stored exclusively in your private {providerLabel}{' '}
                  <span className="font-mono">appDataFolder</span> (
                  <span className="font-mono">{remoteFileName}</span>). Zero DRM keys or
                  fingerprints are ever written to Cloud Firestore.
                </p>
              </div>
              <div className="py-3">
                <div className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  04. Deterministic Conflict Merge
                </div>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-400">
                  Unlocking on a second device verifies the GCM authentication tag + AAD and merges
                  keys by <span className="font-mono">keyId</span> and{' '}
                  <span className="font-mono">updatedAt</span> without losing retired rotation
                  history.
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-[#1E2536]">
              <button
                type="button"
                onClick={() => setSpecDialogOpen(false)}
                className="min-h-[40px] w-full rounded-lg bg-[#E5A93C] px-5 py-2 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[36px] sm:w-auto"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dialog: Rotate Master Passphrase */}
      {rotateDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rotate-passphrase-dialog-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => {
            if (!isSubmitting) setRotateDialogOpen(false);
          }}
        >
          <div
            className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-xl sm:p-6 dark:border-[#242C3F] dark:bg-[#121620]"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700"
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5 dark:border-[#1E2536]">
              <div>
                <h2
                  id="rotate-passphrase-dialog-title"
                  className="font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]"
                >
                  Rotate Cloud Keyring Master Passphrase
                </h2>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Generates a fresh 128-bit PBKDF2 salt and re-seals your remote {providerLabel}{' '}
                  bundle
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setRotateDialogOpen(false)}
                aria-label="Close passphrase rotation dialog"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={handleSubmitRotatePassphrase} className="mt-4 space-y-4">
              {formError && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                  {formError}
                </p>
              )}

              <div>
                <label
                  htmlFor="rotate-cloud-master-pass"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  New Master Passphrase
                </label>
                <div className="relative mt-1">
                  <input
                    id="rotate-cloud-master-pass"
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="off"
                    value={masterPassphrase}
                    onChange={(e) => setMasterPassphrase(e.target.value)}
                    placeholder={`At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`}
                    className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase((v) => !v)}
                    aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {showPassphrase ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="rotate-cloud-confirm-pass"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm New Master Passphrase
                </label>
                <input
                  id="rotate-cloud-confirm-pass"
                  type={showPassphrase ? 'text' : 'password'}
                  autoComplete="off"
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter new Master Passphrase"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div>
                <label
                  htmlFor="rotate-cloud-hint"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Updated Optional Hint
                </label>
                <input
                  id="rotate-cloud-hint"
                  type="text"
                  maxLength={80}
                  value={hintInput}
                  onChange={(e) => setHintInput(e.target.value)}
                  placeholder="Optional non-secret reminder"
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-[#1E2536]">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setRotateDialogOpen(false)}
                  className="min-h-[42px] rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || isSyncingKeyring}
                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-4 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap"
                >
                  {isSubmitting ? 'Re-Sealing...' : 'Save & Re-Seal Keyring'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation: Overwrite existing remote Cloud Keyring */}
      <KeyringConfirmDialog
        open={confirmOverwriteOpen}
        title={`Overwrite Existing ${providerLabel} Cloud Keyring?`}
        description={`An encrypted Cloud Keyring bundle already exists in your ${providerLabel} appDataFolder. Continuing will replace that remote bundle with this device's current local keys sealed under your new Master Passphrase.`}
        confirmLabel="Overwrite Cloud Keyring"
        onCancel={() => setConfirmOverwriteOpen(false)}
        onConfirm={() => {
          setConfirmOverwriteOpen(false);
          void executeEnableOrUnlock(true);
        }}
      />

      {/* Confirmation: Opt Out & Delete remote Cloud Keyring */}
      <KeyringConfirmDialog
        open={confirmDisableDeleteOpen}
        title={`Delete Encrypted Cloud Keyring from ${providerLabel}?`}
        description={`This turns off Cloud Keyring sync and permanently removes ${remoteFileName} from your ${providerLabel} appDataFolder. Keys already stored in this browser's IndexedDB will remain intact.`}
        confirmLabel="Delete Remote Cloud Keyring"
        onCancel={() => setConfirmDisableDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDisableDeleteOpen(false);
          void onDisableCloudKeyring(true);
        }}
      />
    </div>
  );
};
