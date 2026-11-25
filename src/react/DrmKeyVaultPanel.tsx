import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  DEFAULT_KEYRING_FILENAME,
  MAX_DRM_HINT_LENGTH,
  MAX_DRM_KEY_LABEL_LENGTH,
  MIN_DRM_PASSPHRASE_LENGTH,
} from '../constants.js';
import type {
  DrmManagedKey,
  DrmProtectedItem,
  RemoteKeyringSummary,
} from '../types.js';
import { formatBytes } from '../utils.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';

export interface CreateDrmKeySubmission {
  label: string;
  passphrase: string;
  keyHint: string;
  setAsDefault: boolean;
}

export interface RotateDrmKeySubmission {
  keyId: string;
  currentPassphrase: string;
  newPassphrase?: string;
  newLabel: string;
  newKeyHint: string;
  rewrapBoundLocalBooks: boolean;
  deepReencryptPayload: boolean;
}

export interface DrmKeyVaultPanelProps<TItem extends DrmProtectedItem = DrmProtectedItem> {
  drmKeys: DrmManagedKey[];
  items?: TItem[];
  libraryBooks?: TItem[];
  isDriveConnected: boolean;
  isDriveSessionLive?: boolean;
  isSigningIn?: boolean;
  remoteDriveBackup: RemoteKeyringSummary | null;
  isInspectingDriveBackup: boolean;
  providerLabel?: string;
  remoteFileName?: string;
  renderConnectButton?: () => React.ReactNode;
  onConnectDrive: () => void;
  onRefreshDriveBackupStatus: () => Promise<void>;
  onCreateKey: (submission: CreateDrmKeySubmission) => Promise<void>;
  onRotateKey: (
    submission: RotateDrmKeySubmission
  ) => Promise<{ rotatedBookCount: number }>;
  onSetDefaultKey: (keyId: string) => Promise<void>;
  onDeleteLocalKey: (keyId: string) => Promise<void>;
  onBackupKeyringToDrive: (
    backupPassphrase: string,
    backupHint: string
  ) => Promise<void>;
  onRestoreKeyringFromDrive: (
    backupPassphrase: string,
    strategy: 'merge' | 'replace'
  ) => Promise<{ restoredCount: number }>;
  onDeleteDriveKeyringBackup: () => Promise<void>;
  onExportLocalKeyringFile: (
    backupPassphrase: string,
    backupHint: string
  ) => Promise<void>;
  onImportLocalKeyringFile: (
    rawJson: string,
    backupPassphrase: string,
    strategy: 'merge' | 'replace'
  ) => Promise<{ restoredCount: number }>;
}

function formatDateTimeShort(epochOrIso: number | string): string {
  const ts =
    typeof epochOrIso === 'number' ? epochOrIso : Date.parse(epochOrIso);
  if (!Number.isFinite(ts) || ts <= 0) return 'Unknown date';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function DrmKeyVaultPanel<TItem extends DrmProtectedItem = DrmProtectedItem>({
  drmKeys,
  items,
  libraryBooks,
  isDriveConnected,
  isDriveSessionLive = isDriveConnected,
  isSigningIn = false,
  remoteDriveBackup,
  isInspectingDriveBackup,
  providerLabel = 'Google Drive',
  remoteFileName = DEFAULT_KEYRING_FILENAME,
  renderConnectButton,
  onConnectDrive,
  onRefreshDriveBackupStatus,
  onCreateKey,
  onRotateKey,
  onSetDefaultKey,
  onDeleteLocalKey,
  onBackupKeyringToDrive,
  onRestoreKeyringFromDrive,
  onDeleteDriveKeyringBackup,
  onExportLocalKeyringFile,
  onImportLocalKeyringFile,
}: DrmKeyVaultPanelProps<TItem>): React.ReactElement {
  const effectiveItems = items ?? libraryBooks ?? [];

  // --- 1. Create New Managed Key Form State ---
  const [newLabel, setNewLabel] = useState('');
  const [newPassphrase, setNewPassphrase] = useState('');
  const [newConfirmPassphrase, setNewConfirmPassphrase] = useState('');
  const [newHint, setNewHint] = useState('');
  const [newSetDefault, setNewSetDefault] = useState(true);
  const [showNewPass, setShowNewPass] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [createKeyError, setCreateKeyError] = useState<string | null>(null);
  const [createKeySuccess, setCreateKeySuccess] = useState<string | null>(null);

  // --- 2. Rotate Key Inline Drawer State ---
  const [rotatingKeyId, setRotatingKeyId] = useState<string | null>(null);
  const [rotCurrentPass, setRotCurrentPass] = useState('');
  const [rotChangePass, setRotChangePass] = useState(false);
  const [rotNewPass, setRotNewPass] = useState('');
  const [rotConfirmNewPass, setRotConfirmNewPass] = useState('');
  const [rotNewLabel, setRotNewLabel] = useState('');
  const [rotNewHint, setRotNewHint] = useState('');
  const [rotRewrapBooks, setRotRewrapBooks] = useState(true);
  const [rotDeepReencrypt, setRotDeepReencrypt] = useState(false);
  const [showRotPass, setShowRotPass] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);

  // --- 3. Cloud & Portable Backup / Restore State ---
  const [cloudTab, setCloudTab] = useState<'BACKUP' | 'RESTORE'>('BACKUP');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupConfirmPassphrase, setBackupConfirmPassphrase] = useState('');
  const [backupHint, setBackupHint] = useState('');
  const [showBackupPass, setShowBackupPass] = useState(false);

  const [restorePassphrase, setRestorePassphrase] = useState('');
  const [restoreStrategy, setRestoreStrategy] = useState<'merge' | 'replace'>('merge');
  const [showRestorePass, setShowRestorePass] = useState(false);
  const [pendingPortableJson, setPendingPortableJson] = useState<{
    fileName: string;
    rawJson: string;
  } | null>(null);

  const [isCloudBusy, setIsCloudBusy] = useState(false);
  const [cloudFeedback, setCloudFeedback] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // --- 4. Explicit User Confirmation Modals ---
  const [confirmOverwriteDriveOpen, setConfirmOverwriteDriveOpen] = useState(false);
  const [confirmDeleteDriveOpen, setConfirmDeleteDriveOpen] = useState(false);
  const [confirmReplaceLocalOpen, setConfirmReplaceLocalOpen] = useState<'drive' | 'file' | null>(
    null
  );
  const [pendingDeleteLocalKey, setPendingDeleteLocalKey] = useState<DrmManagedKey | null>(
    null
  );

  const portableFileInputRef = useRef<HTMLInputElement | null>(null);

  const boundBooksByKeyId = useMemo(() => {
    const map = new Map<string, TItem[]>();
    for (const item of effectiveItems) {
      const kId = item.drm?.keyId;
      if (!kId) continue;
      const list = map.get(kId) ?? [];
      list.push(item);
      map.set(kId, list);
    }
    return map;
  }, [effectiveItems]);

  const activeKeysCount = useMemo(
    () => drmKeys.filter((k) => k.status === 'active').length,
    [drmKeys]
  );

  const rotatingKey = useMemo(
    () => drmKeys.find((k) => k.keyId === rotatingKeyId) ?? null,
    [drmKeys, rotatingKeyId]
  );

  const rotatingBoundLocalBooks = useMemo(() => {
    if (!rotatingKey) return [];
    return (boundBooksByKeyId.get(rotatingKey.keyId) ?? []).filter(
      (b) => b.source === 'local'
    );
  }, [boundBooksByKeyId, rotatingKey]);

  const openRotateDrawer = (key: DrmManagedKey) => {
    setRotatingKeyId(key.keyId);
    setRotCurrentPass('');
    setRotChangePass(false);
    setRotNewPass('');
    setRotConfirmNewPass('');
    setRotNewLabel(key.label);
    setRotNewHint(key.keyHint ?? '');
    setRotRewrapBooks(true);
    setRotDeepReencrypt(false);
    setShowRotPass(false);
    setRotateError(null);
  };

  const handleCreateKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateKeyError(null);
    setCreateKeySuccess(null);

    const cleanLabel = newLabel.trim().slice(0, MAX_DRM_KEY_LABEL_LENGTH);
    if (!cleanLabel) {
      setCreateKeyError('Enter a descriptive key label (e.g. "Primary Archive Key").');
      return;
    }
    if (newPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      setCreateKeyError(
        `Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
      );
      return;
    }
    if (newPassphrase !== newConfirmPassphrase) {
      setCreateKeyError('Passphrase and confirmation do not match.');
      return;
    }
    if (
      newHint.trim() &&
      newHint.trim().toLowerCase() === newPassphrase.trim().toLowerCase()
    ) {
      setCreateKeyError('Never enter your passphrase inside the optional hint field.');
      return;
    }

    setIsCreatingKey(true);
    try {
      await onCreateKey({
        label: cleanLabel,
        passphrase: newPassphrase,
        keyHint: newHint.trim().slice(0, MAX_DRM_HINT_LENGTH),
        setAsDefault: newSetDefault || activeKeysCount === 0,
      });
      setNewLabel('');
      setNewPassphrase('');
      setNewConfirmPassphrase('');
      setNewHint('');
      setCreateKeySuccess(`Created wrapped 256-bit key "${cleanLabel}".`);
    } catch (err) {
      setCreateKeyError(
        err instanceof Error ? err.message : 'Failed to create Managed DRM key.'
      );
    } finally {
      setIsCreatingKey(false);
    }
  };

  const handleRotateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rotatingKey) return;
    setRotateError(null);

    if (!rotCurrentPass) {
      setRotateError('Enter the current passphrase for this key to authorize rotation.');
      return;
    }
    if (rotChangePass) {
      if (rotNewPass.length < MIN_DRM_PASSPHRASE_LENGTH) {
        setRotateError(
          `New passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
        );
        return;
      }
      if (rotNewPass !== rotConfirmNewPass) {
        setRotateError('New passphrase confirmation does not match.');
        return;
      }
    }

    const candidatePass = rotChangePass ? rotNewPass : rotCurrentPass;
    if (
      rotNewHint.trim() &&
      rotNewHint.trim().toLowerCase() === candidatePass.trim().toLowerCase()
    ) {
      setRotateError('Never enter your passphrase inside the optional hint field.');
      return;
    }

    setIsRotating(true);
    try {
      await onRotateKey({
        keyId: rotatingKey.keyId,
        currentPassphrase: rotCurrentPass,
        newPassphrase: rotChangePass ? rotNewPass : undefined,
        newLabel: rotNewLabel.trim() || rotatingKey.label,
        newKeyHint: rotNewHint.trim().slice(0, MAX_DRM_HINT_LENGTH),
        rewrapBoundLocalBooks: rotRewrapBooks,
        deepReencryptPayload: rotRewrapBooks && rotDeepReencrypt,
      });
      setRotatingKeyId(null);
      setRotCurrentPass('');
      setRotNewPass('');
      setRotConfirmNewPass('');
    } catch (err) {
      setRotateError(err instanceof Error ? err.message : 'Failed to rotate DRM key.');
    } finally {
      setIsRotating(false);
    }
  };

  const validateBackupInputs = (): string | null => {
    if (drmKeys.length === 0) {
      return 'Create at least one Managed DRM key before backing up your keyring.';
    }
    if (backupPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      return `Backup passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`;
    }
    if (backupPassphrase !== backupConfirmPassphrase) {
      return 'Backup passphrase confirmation does not match.';
    }
    if (
      backupHint.trim() &&
      backupHint.trim().toLowerCase() === backupPassphrase.trim().toLowerCase()
    ) {
      return 'Never write your backup passphrase inside the optional hint field.';
    }
    return null;
  };

  const executeDriveBackupNow = async () => {
    setIsCloudBusy(true);
    setCloudFeedback(null);
    try {
      await onBackupKeyringToDrive(
        backupPassphrase,
        backupHint.trim().slice(0, MAX_DRM_HINT_LENGTH)
      );
      setBackupPassphrase('');
      setBackupConfirmPassphrase('');
      setCloudFeedback({
        tone: 'success',
        text: `Encrypted ${drmKeys.length} ${
          drmKeys.length === 1 ? 'key' : 'keys'
        } with AES-256-GCM and backed up to your ${providerLabel} appDataFolder.`,
      });
    } catch (err) {
      setCloudFeedback({
        tone: 'error',
        text: err instanceof Error ? err.message : `${providerLabel} keyring backup failed.`,
      });
    } finally {
      setIsCloudBusy(false);
    }
  };

  const handleRequestDriveBackup = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateBackupInputs();
    if (err) {
      setCloudFeedback({ tone: 'error', text: err });
      return;
    }
    if (remoteDriveBackup) {
      setConfirmOverwriteDriveOpen(true);
      return;
    }
    void executeDriveBackupNow();
  };

  const handleExportPortableBackup = async () => {
    const err = validateBackupInputs();
    if (err) {
      setCloudFeedback({ tone: 'error', text: err });
      return;
    }
    setIsCloudBusy(true);
    setCloudFeedback(null);
    try {
      await onExportLocalKeyringFile(
        backupPassphrase,
        backupHint.trim().slice(0, MAX_DRM_HINT_LENGTH)
      );
      setCloudFeedback({
        tone: 'success',
        text: 'Downloaded encrypted .nkey.json keyring backup file.',
      });
    } catch (e) {
      setCloudFeedback({
        tone: 'error',
        text: e instanceof Error ? e.message : 'Failed to export portable keyring file.',
      });
    } finally {
      setIsCloudBusy(false);
    }
  };

  const executeRestoreFromDriveNow = async () => {
    setIsCloudBusy(true);
    setCloudFeedback(null);
    try {
      const { restoredCount } = await onRestoreKeyringFromDrive(
        restorePassphrase,
        restoreStrategy
      );
      setRestorePassphrase('');
      setCloudFeedback({
        tone: 'success',
        text: `Restored ${restoredCount} Managed DRM ${
          restoredCount === 1 ? 'key' : 'keys'
        } from ${providerLabel}.`,
      });
    } catch (err) {
      setCloudFeedback({
        tone: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to restore keyring from ${providerLabel}.`,
      });
    } finally {
      setIsCloudBusy(false);
    }
  };

  const executeRestoreFromFileNow = async () => {
    if (!pendingPortableJson) return;
    setIsCloudBusy(true);
    setCloudFeedback(null);
    try {
      const { restoredCount } = await onImportLocalKeyringFile(
        pendingPortableJson.rawJson,
        restorePassphrase,
        restoreStrategy
      );
      setRestorePassphrase('');
      setPendingPortableJson(null);
      setCloudFeedback({
        tone: 'success',
        text: `Restored ${restoredCount} Managed DRM ${
          restoredCount === 1 ? 'key' : 'keys'
        } from portable backup file.`,
      });
    } catch (err) {
      setCloudFeedback({
        tone: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to import portable keyring file.',
      });
    } finally {
      setIsCloudBusy(false);
    }
  };

  const handleRequestDriveRestore = (e: React.FormEvent) => {
    e.preventDefault();
    if (!restorePassphrase) {
      setCloudFeedback({
        tone: 'error',
        text: 'Enter your backup passphrase to decrypt the keyring.',
      });
      return;
    }
    if (pendingPortableJson) {
      if (restoreStrategy === 'replace' && drmKeys.length > 0) {
        setConfirmReplaceLocalOpen('file');
        return;
      }
      void executeRestoreFromFileNow();
      return;
    }
    if (!remoteDriveBackup) {
      setCloudFeedback({
        tone: 'error',
        text: `No DRM keyring backup was found in your ${providerLabel} appDataFolder.`,
      });
      return;
    }
    if (restoreStrategy === 'replace' && drmKeys.length > 0) {
      setConfirmReplaceLocalOpen('drive');
      return;
    }
    void executeRestoreFromDriveNow();
  };

  const handlePortableFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const rawJson = await file.text();
      setPendingPortableJson({ fileName: file.name, rawJson });
      setCloudTab('RESTORE');
      setCloudFeedback(null);
    } catch {
      setCloudFeedback({
        tone: 'error',
        text: 'Unable to read selected keyring backup file.',
      });
    }
  };

  const pendingDeleteBoundBooks = pendingDeleteLocalKey
    ? boundBooksByKeyId.get(pendingDeleteLocalKey.keyId) ?? []
    : [];

  const connectButtonNode = renderConnectButton ? (
    renderConnectButton()
  ) : (
    <button
      type="button"
      disabled={isSigningIn}
      onClick={onConnectDrive}
      className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-[#283248] dark:bg-[#121620] dark:text-slate-100 dark:hover:bg-[#1B2232] whitespace-nowrap"
    >
      <Cloud className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
      <span>{isSigningIn ? 'Connecting...' : `Connect ${providerLabel}`}</span>
    </button>
  );

  return (
    <div className="grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-12 items-start">
      {/* LEFT 7 COLUMNS: MANAGED KEYRING INVENTORY & ROTATION WORKSPACE */}
      <div className="space-y-5 sm:space-y-6 lg:col-span-7">
        <section
          aria-labelledby="drm-keyring-inventory-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-[#1B2130]">
            <div>
              <h2
                id="drm-keyring-inventory-heading"
                className="font-display text-lg font-semibold text-slate-900 dark:text-[#E8ECF4]"
              >
                Managed DRM Keyring
              </h2>
              <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {activeKeysCount} Active · {drmKeys.length - activeKeysCount} Retired · Wrapped
                at rest (PBKDF2-SHA256 + AES-256-GCM)
              </p>
            </div>
          </div>

          {drmKeys.length === 0 ? (
            <div className="py-8 text-center sm:py-10">
              <KeyRound
                className="mx-auto h-8 w-8 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <h3 className="mt-3 font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]">
                No Managed DRM Keys Yet
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Create a named 256-bit vault key to encrypt uploads, rotate keys across volumes in
                milliseconds without exposing plaintext on disk, and back up or restore your
                encrypted keyring via {providerLabel}.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-[#1B2130]">
              {drmKeys.map((key) => {
                const boundBooks = boundBooksByKeyId.get(key.keyId) ?? [];
                const isRotOpen = rotatingKeyId === key.keyId;

                return (
                  <div key={key.keyId} className="py-4 first:pt-4 last:pb-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-display text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]">
                            {key.label}
                          </span>
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            · v{key.generation}
                          </span>
                          {key.status === 'active' ? (
                            <span className="font-mono text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              · Active{key.isDefault ? ' (Default)' : ''}
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                              · Retired
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                          <span title="SHA-256 key fingerprint" className="break-all sm:break-normal">
                            {key.fingerprint}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            {boundBooks.length}{' '}
                            {boundBooks.length === 1 ? 'volume' : 'volumes'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>Created {formatDateTimeShort(key.createdAt)}</span>
                          {key.rotatedAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Rotated {formatDateTimeShort(key.rotatedAt)}</span>
                            </>
                          )}
                        </div>

                        {key.keyHint && (
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            Hint: {key.keyHint}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-1.5 shrink-0">
                        {key.status === 'active' && !key.isDefault && (
                          <button
                            type="button"
                            onClick={() => void onSetDefaultKey(key.keyId)}
                            className="min-h-[42px] rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:min-h-[34px] sm:px-2.5 dark:border-[#252E42] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0"
                          >
                            Set Default
                          </button>
                        )}

                        {key.status === 'active' && (
                          <button
                            type="button"
                            onClick={() =>
                              isRotOpen ? setRotatingKeyId(null) : openRotateDrawer(key)
                            }
                            className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap shrink-0 ${
                              isRotOpen
                                ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-[#252E42] dark:text-slate-200 dark:hover:bg-[#1B2232]'
                            }`}
                          >
                            <RotateCw className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
                            <span>{isRotOpen ? 'Close Rotate' : 'Rotate Key'}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setPendingDeleteLocalKey(key)}
                          aria-label={`Delete key ${key.label}`}
                          title="Delete key from local keyring"
                          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-red-400 hover:text-red-500 sm:min-h-[34px] sm:min-w-[34px] dark:border-[#252E42] dark:text-slate-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {isRotOpen && rotatingKey && (
                      <form
                        onSubmit={(e) => void handleRotateSubmit(e)}
                        className="mt-4 space-y-3.5 border-t border-slate-100 pt-4 dark:border-[#1E2536]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-display text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]">
                            Rotate &ldquo;{rotatingKey.label}&rdquo; (v{rotatingKey.generation} → v
                            {rotatingKey.generation + 1})
                          </h4>
                          <button
                            type="button"
                            onClick={() => setRotatingKeyId(null)}
                            className="text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]"
                          >
                            Cancel
                          </button>
                        </div>

                        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          Generates a fresh 256-bit AES key, marks{' '}
                          <code className="break-all font-mono sm:break-normal">
                            {rotatingKey.fingerprint}
                          </code>{' '}
                          as retired (kept in keyring so older exported{' '}
                          <code className="font-mono">.ndrm</code> files remain readable), and
                          re-wraps local volumes in RAM.
                        </p>

                        {rotateError && (
                          <div
                            role="alert"
                            className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
                          >
                            {rotateError}
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`rot-cur-pass-${key.keyId}`}
                              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                            >
                              Current Key Passphrase
                            </label>
                            <div className="relative mt-1">
                              <input
                                id={`rot-cur-pass-${key.keyId}`}
                                type={showRotPass ? 'text' : 'password'}
                                autoComplete="current-password"
                                disabled={isRotating}
                                value={rotCurrentPass}
                                onChange={(e) => setRotCurrentPass(e.target.value)}
                                placeholder="Authorize current key..."
                                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                              />
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setShowRotPass((s) => !s)}
                                aria-label={showRotPass ? 'Hide passphrase' : 'Show passphrase'}
                                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                              >
                                {showRotPass ? (
                                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                                ) : (
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div>
                            <label
                              htmlFor={`rot-label-${key.keyId}`}
                              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                            >
                              Rotated Key Label
                            </label>
                            <input
                              id={`rot-label-${key.keyId}`}
                              type="text"
                              maxLength={MAX_DRM_KEY_LABEL_LENGTH}
                              disabled={isRotating}
                              value={rotNewLabel}
                              onChange={(e) => setRotNewLabel(e.target.value)}
                              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                            />
                          </div>
                        </div>

                        <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={rotChangePass}
                            onChange={(e) => setRotChangePass(e.target.checked)}
                            className="h-4 w-4 rounded accent-[#E5A93C]"
                          />
                          <span>Also change the unlock passphrase on the new key generation</span>
                        </label>

                        {rotChangePass && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <label
                                htmlFor={`rot-new-pass-${key.keyId}`}
                                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                              >
                                New Passphrase (min {MIN_DRM_PASSPHRASE_LENGTH} chars)
                              </label>
                              <input
                                id={`rot-new-pass-${key.keyId}`}
                                type={showRotPass ? 'text' : 'password'}
                                autoComplete="new-password"
                                disabled={isRotating}
                                value={rotNewPass}
                                onChange={(e) => setRotNewPass(e.target.value)}
                                placeholder="New passphrase..."
                                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`rot-confirm-pass-${key.keyId}`}
                                className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                              >
                                Confirm New Passphrase
                              </label>
                              <input
                                id={`rot-confirm-pass-${key.keyId}`}
                                type={showRotPass ? 'text' : 'password'}
                                autoComplete="new-password"
                                disabled={isRotating}
                                value={rotConfirmNewPass}
                                onChange={(e) => setRotConfirmNewPass(e.target.value)}
                                placeholder="Confirm new passphrase..."
                                className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                              />
                            </div>
                          </div>
                        )}

                        <div>
                          <label
                            htmlFor={`rot-hint-${key.keyId}`}
                            className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                          >
                            Optional Non-Secret Hint
                          </label>
                          <input
                            id={`rot-hint-${key.keyId}`}
                            type="text"
                            maxLength={MAX_DRM_HINT_LENGTH}
                            disabled={isRotating}
                            value={rotNewHint}
                            onChange={(e) => setRotNewHint(e.target.value)}
                            placeholder="Optional memory cue..."
                            className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                          />
                        </div>

                        {rotatingBoundLocalBooks.length > 0 && (
                          <div className="space-y-2 pt-1">
                            <label className="flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300">
                              <input
                                type="checkbox"
                                checked={rotRewrapBooks}
                                onChange={(e) => setRotRewrapBooks(e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                              />
                              <span>
                                Re-wrap{' '}
                                <strong className="font-mono tabular-nums">
                                  {rotatingBoundLocalBooks.length}
                                </strong>{' '}
                                local{' '}
                                {rotatingBoundLocalBooks.length === 1 ? 'volume' : 'volumes'} to the
                                new key immediately
                              </span>
                            </label>

                            {rotRewrapBooks && (
                              <label className="ml-6 flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400">
                                <input
                                  type="checkbox"
                                  checked={rotDeepReencrypt}
                                  onChange={(e) => setRotDeepReencrypt(e.target.checked)}
                                  className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]"
                                />
                                <span>
                                  Deep re-key (also generate fresh per-book DEKs and re-encrypt full
                                  archive ciphertext in RAM)
                                </span>
                              </label>
                            )}
                          </div>
                        )}

                        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end">
                          <button
                            type="button"
                            disabled={isRotating}
                            onClick={() => setRotatingKeyId(null)}
                            className="min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[36px] sm:w-auto dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={isRotating}
                            className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-4 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] disabled:opacity-60 sm:min-h-[36px] sm:w-auto whitespace-nowrap shrink-0"
                          >
                            {isRotating ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                <span>Rotating Key...</span>
                              </>
                            ) : (
                              <>
                                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Confirm Key Rotation</span>
                              </>
                            )}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Security Guarantees Explainer */}
        <section
          aria-labelledby="drm-kms-explainer-heading"
          className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck
              className="h-4 w-4 shrink-0 text-[#C5841A] dark:text-[#E5A93C]"
              aria-hidden="true"
            />
            <h3
              id="drm-kms-explainer-heading"
              className="font-display text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]"
            >
              Zero-Plaintext Key Lifecycle &amp; {providerLabel} Vault Security
            </h3>
          </div>
          <dl className="mt-4 space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            <div>
              <dt className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                01. Envelope Key Rotation Without Disk Exposure
              </dt>
              <dd className="mt-0.5">
                Managed keys are 256-bit random AES-GCM keys stored wrapped under{' '}
                <code className="font-mono">PBKDF2-SHA256</code> (210k iterations). Rotating a key
                re-wraps each book&apos;s Data-Encryption Key in volatile RAM and zeroes raw key
                buffers immediately.
              </dd>
            </div>
            <div className="border-t border-slate-100 pt-3 dark:border-[#1B2130]">
              <dt className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                02. Double-Encrypted {providerLabel} Backup &amp; Restore
              </dt>
              <dd className="mt-0.5">
                When backing up to {providerLabel} (<code className="font-mono">appDataFolder</code>),
                all wrapped keys are sealed inside a second outer{' '}
                <code className="font-mono">AES-256-GCM</code> vault encrypted with your Backup
                Passphrase before leaving your browser.
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* RIGHT 5 COLUMNS: NEW KEY GENERATOR + CLOUD BACKUP & RESTORE */}
      <aside className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 lg:col-span-5 dark:border-[#1E2536] dark:bg-[#121620]">
        <form onSubmit={(e) => void handleCreateKeySubmit(e)} className="space-y-3.5">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]">
              Create New DRM Key
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Generates a random 256-bit AES key wrapped under your passphrase. Raw key bytes are
              never persisted unencrypted.
            </p>
          </div>

          {createKeyError && (
            <div
              role="alert"
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            >
              {createKeyError}
            </div>
          )}

          {createKeySuccess && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300"
            >
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{createKeySuccess}</span>
            </div>
          )}

          <div>
            <label
              htmlFor="new-drm-key-label"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Key Name
            </label>
            <input
              id="new-drm-key-label"
              type="text"
              maxLength={MAX_DRM_KEY_LABEL_LENGTH}
              disabled={isCreatingKey}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Primary Archive Key"
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
            />
          </div>

          <div>
            <label
              htmlFor="new-drm-key-pass"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Key Passphrase (min {MIN_DRM_PASSPHRASE_LENGTH} characters)
            </label>
            <div className="relative mt-1">
              <input
                id="new-drm-key-pass"
                type={showNewPass ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={isCreatingKey}
                value={newPassphrase}
                onChange={(e) => setNewPassphrase(e.target.value)}
                placeholder="Choose key unlock passphrase..."
                className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowNewPass((s) => !s)}
                aria-label={showNewPass ? 'Hide passphrase' : 'Show passphrase'}
                className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showNewPass ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="new-drm-key-confirm"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Confirm Passphrase
            </label>
            <input
              id="new-drm-key-confirm"
              type={showNewPass ? 'text' : 'password'}
              autoComplete="new-password"
              disabled={isCreatingKey}
              value={newConfirmPassphrase}
              onChange={(e) => setNewConfirmPassphrase(e.target.value)}
              placeholder="Re-enter passphrase..."
              className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
            />
          </div>

          <div>
            <label
              htmlFor="new-drm-key-hint"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Optional Non-Secret Hint
            </label>
            <input
              id="new-drm-key-hint"
              type="text"
              maxLength={MAX_DRM_HINT_LENGTH}
              disabled={isCreatingKey}
              value={newHint}
              onChange={(e) => setNewHint(e.target.value)}
              placeholder="Memory cue (never write your passphrase)"
              className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={newSetDefault || activeKeysCount === 0}
              disabled={activeKeysCount === 0}
              onChange={(e) => setNewSetDefault(e.target.checked)}
              className="h-4 w-4 rounded accent-[#E5A93C]"
            />
            <span>Set as default key for new encrypted uploads</span>
          </label>

          <button
            type="submit"
            disabled={isCreatingKey}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-60 sm:min-h-[40px] whitespace-nowrap"
          >
            {isCreatingKey ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Generating &amp; Wrapping 256-Bit Key...</span>
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create Managed DRM Key</span>
              </>
            )}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-6 dark:border-[#1E2536]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]">
                {providerLabel} Key Backup &amp; Restore
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Store or recover your encrypted DRM keyring in your private {providerLabel}{' '}
                <code className="font-mono">appDataFolder</code>.
              </p>
            </div>
            {isDriveConnected && (
              <button
                type="button"
                disabled={isInspectingDriveBackup || isCloudBusy}
                onClick={() => void onRefreshDriveBackupStatus()}
                aria-label={`Refresh ${providerLabel} keyring backup status`}
                title={`Check ${providerLabel} backup status`}
                className="flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[34px] sm:min-w-[34px] dark:border-[#252E42] dark:text-slate-300 dark:hover:bg-[#1B2232]"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isInspectingDriveBackup ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </button>
            )}
          </div>

          <div className="mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs dark:bg-[#0D1018]">
            {!isDriveConnected ? (
              <div className="space-y-2.5">
                <p className="text-slate-600 dark:text-slate-400">
                  Connect {providerLabel} to back up or restore your encrypted DRM keyring across
                  devices, or use portable <code className="font-mono">.nkey.json</code> files
                  offline.
                </p>
                {connectButtonNode}
              </div>
            ) : isInspectingDriveBackup ? (
              <p className="flex items-center gap-2 font-mono text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#E5A93C]" aria-hidden="true" />
                <span>Checking {providerLabel} appDataFolder...</span>
              </p>
            ) : remoteDriveBackup ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                    Cloud Keyring Backup Available
                  </span>
                  <button
                    type="button"
                    disabled={isCloudBusy}
                    onClick={() => setConfirmDeleteDriveOpen(true)}
                    className="text-[11px] font-medium text-red-600 hover:underline dark:text-red-400 whitespace-nowrap"
                  >
                    Delete Cloud Backup
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  {remoteDriveBackup.header
                    ? `${remoteDriveBackup.header.keyCount} ${
                        remoteDriveBackup.header.keyCount === 1 ? 'key' : 'keys'
                      } · `
                    : ''}
                  {formatBytes(remoteDriveBackup.sizeBytes)} · Updated{' '}
                  {formatDateTimeShort(
                    remoteDriveBackup.header?.createdAt ?? remoteDriveBackup.modifiedTime
                  )}
                </p>
                {remoteDriveBackup.header?.backupHint && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Backup hint: {remoteDriveBackup.header.backupHint}
                  </p>
                )}
              </div>
            ) : !isDriveSessionLive ? (
              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {providerLabel} ready on demand · Click refresh or restore below to inspect appDataFolder
              </p>
            ) : (
              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                {providerLabel} connected · No keyring backup saved in appDataFolder yet
              </p>
            )}
          </div>

          <div
            role="tablist"
            aria-label="Keyring backup or restore mode"
            className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0D1018]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={cloudTab === 'BACKUP'}
              onClick={() => {
                setCloudTab('BACKUP');
                setCloudFeedback(null);
              }}
              className={`min-h-[40px] rounded-md px-3 py-1 text-xs font-medium transition-colors sm:min-h-[34px] whitespace-nowrap ${
                cloudTab === 'BACKUP'
                  ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
              }`}
            >
              Backup Keyring
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={cloudTab === 'RESTORE'}
              onClick={() => {
                setCloudTab('RESTORE');
                setCloudFeedback(null);
              }}
              className={`min-h-[40px] rounded-md px-3 py-1 text-xs font-medium transition-colors sm:min-h-[34px] whitespace-nowrap ${
                cloudTab === 'RESTORE'
                  ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'
              }`}
            >
              Restore Keyring
            </button>
          </div>

          {cloudFeedback && (
            <div
              role={cloudFeedback.tone === 'error' ? 'alert' : 'status'}
              className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
                cloudFeedback.tone === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
              }`}
            >
              {cloudFeedback.text}
            </div>
          )}

          <input
            ref={portableFileInputRef}
            type="file"
            accept=".json,application/json"
            onChange={(e) => void handlePortableFileChange(e)}
            className="hidden"
          />

          {cloudTab === 'BACKUP' ? (
            <form onSubmit={handleRequestDriveBackup} className="mt-4 space-y-3">
              <div>
                <label
                  htmlFor="drive-backup-pass"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Backup Vault Passphrase (min {MIN_DRM_PASSPHRASE_LENGTH} chars)
                </label>
                <div className="relative mt-1">
                  <input
                    id="drive-backup-pass"
                    type={showBackupPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    disabled={isCloudBusy}
                    value={backupPassphrase}
                    onChange={(e) => setBackupPassphrase(e.target.value)}
                    placeholder="Passphrase to seal outer backup..."
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowBackupPass((s) => !s)}
                    aria-label={showBackupPass ? 'Hide passphrase' : 'Show passphrase'}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showBackupPass ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="drive-backup-confirm"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Confirm Backup Passphrase
                </label>
                <input
                  id="drive-backup-confirm"
                  type={showBackupPass ? 'text' : 'password'}
                  autoComplete="new-password"
                  disabled={isCloudBusy}
                  value={backupConfirmPassphrase}
                  onChange={(e) => setBackupConfirmPassphrase(e.target.value)}
                  placeholder="Re-enter backup passphrase..."
                  className="mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div>
                <label
                  htmlFor="drive-backup-hint"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Optional Backup Hint
                </label>
                <input
                  id="drive-backup-hint"
                  type="text"
                  maxLength={MAX_DRM_HINT_LENGTH}
                  disabled={isCloudBusy}
                  value={backupHint}
                  onChange={(e) => setBackupHint(e.target.value)}
                  placeholder="Optional reminder for backup passphrase"
                  className="mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="submit"
                  disabled={!isDriveConnected || isCloudBusy || drmKeys.length === 0}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap"
                >
                  {isCloudBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Encrypting &amp; Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {remoteDriveBackup
                          ? `Update ${providerLabel} Backup`
                          : `Backup Keyring to ${providerLabel}`}
                      </span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isCloudBusy || drmKeys.length === 0}
                  onClick={() => void handleExportPortableBackup()}
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Download Portable .nkey.json Backup</span>
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRequestDriveRestore} className="mt-4 space-y-3">
              {pendingPortableJson && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-[#E5A93C]/40 bg-[#E5A93C]/10 px-3 py-2 text-xs text-slate-800 dark:text-[#E8ECF4]">
                  <span className="truncate font-mono">
                    File: {pendingPortableJson.fileName}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingPortableJson(null)}
                    aria-label="Clear selected portable file"
                    className="rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div>
                <label
                  htmlFor="drive-restore-pass"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Backup Vault Passphrase
                </label>
                <div className="relative mt-1">
                  <input
                    id="drive-restore-pass"
                    type={showRestorePass ? 'text' : 'password'}
                    autoComplete="current-password"
                    disabled={isCloudBusy}
                    value={restorePassphrase}
                    onChange={(e) => setRestorePassphrase(e.target.value)}
                    placeholder="Enter backup passphrase to decrypt..."
                    className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowRestorePass((s) => !s)}
                    aria-label={showRestorePass ? 'Hide passphrase' : 'Show passphrase'}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showRestorePass ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Restore Mode
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreStrategy('merge')}
                    className={`min-h-[42px] truncate rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:min-h-[36px] sm:px-2.5 whitespace-nowrap ${
                      restoreStrategy === 'merge'
                        ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                        : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'
                    }`}
                  >
                    Merge with Local
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreStrategy('replace')}
                    className={`min-h-[42px] truncate rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:min-h-[36px] sm:px-2.5 whitespace-nowrap ${
                      restoreStrategy === 'replace'
                        ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                        : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'
                    }`}
                  >
                    Replace Local Keys
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  type="submit"
                  disabled={
                    isCloudBusy ||
                    (!pendingPortableJson &&
                      (!isDriveConnected || (isDriveSessionLive && !remoteDriveBackup)))
                  }
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap"
                >
                  {isCloudBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>Decrypting &amp; Restoring...</span>
                    </>
                  ) : pendingPortableJson ? (
                    <>
                      <Upload className="h-4 w-4" aria-hidden="true" />
                      <span>Restore from Selected File</span>
                    </>
                  ) : (
                    <>
                      <Cloud className="h-4 w-4" aria-hidden="true" />
                      <span>Restore Keyring from {providerLabel}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isCloudBusy}
                  onClick={() => portableFileInputRef.current?.click()}
                  className="inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Select Portable .nkey.json File...</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </aside>

      <KeyringConfirmDialog
        open={confirmOverwriteDriveOpen}
        title={`Update Existing ${providerLabel} DRM Keyring Backup?`}
        description={`This will overwrite your existing ${remoteFileName} backup in ${providerLabel} appDataFolder${
          remoteDriveBackup?.header
            ? ` (currently holding ${remoteDriveBackup.header.keyCount} ${
                remoteDriveBackup.header.keyCount === 1 ? 'key' : 'keys'
              } from ${formatDateTimeShort(remoteDriveBackup.header.createdAt)})`
            : ''
        } with ${drmKeys.length} local ${drmKeys.length === 1 ? 'key' : 'keys'}.`}
        confirmLabel="Overwrite Cloud Backup"
        onCancel={() => setConfirmOverwriteDriveOpen(false)}
        onConfirm={() => {
          setConfirmOverwriteDriveOpen(false);
          void executeDriveBackupNow();
        }}
      />

      <KeyringConfirmDialog
        open={confirmDeleteDriveOpen}
        title={`Delete DRM Keyring Backup from ${providerLabel}?`}
        description={`This permanently deletes ${remoteFileName} from your ${providerLabel} appDataFolder. Keys currently stored in this browser remain intact.`}
        confirmLabel="Delete Cloud Backup"
        destructive={true}
        onCancel={() => setConfirmDeleteDriveOpen(false)}
        onConfirm={() => {
          setConfirmDeleteDriveOpen(false);
          setIsCloudBusy(true);
          setCloudFeedback(null);
          void onDeleteDriveKeyringBackup()
            .then(() => {
              setCloudFeedback({
                tone: 'success',
                text: `Deleted DRM keyring backup from ${providerLabel}.`,
              });
            })
            .catch((err) => {
              setCloudFeedback({
                tone: 'error',
                text:
                  err instanceof Error
                    ? err.message
                    : `Failed to delete ${providerLabel} backup.`,
              });
            })
            .finally(() => setIsCloudBusy(false));
        }}
      />

      <KeyringConfirmDialog
        open={confirmReplaceLocalOpen !== null}
        title="Replace Local DRM Keyring?"
        description={`This replaces all ${drmKeys.length} local DRM ${
          drmKeys.length === 1 ? 'key' : 'keys'
        } in this browser with the keys from your backup. Any local key not included in the backup will be removed.`}
        confirmLabel="Replace Local Keys"
        destructive={true}
        onCancel={() => setConfirmReplaceLocalOpen(null)}
        onConfirm={() => {
          const source = confirmReplaceLocalOpen;
          setConfirmReplaceLocalOpen(null);
          if (source === 'file') {
            void executeRestoreFromFileNow();
          } else {
            void executeRestoreFromDriveNow();
          }
        }}
      />

      <KeyringConfirmDialog
        open={pendingDeleteLocalKey !== null}
        title={`Delete Managed Key "${pendingDeleteLocalKey?.label ?? ''}"?`}
        description={
          pendingDeleteBoundBooks.length > 0
            ? `${pendingDeleteBoundBooks.length} volume(s) in your library still reference this key (${pendingDeleteLocalKey?.fingerprint}). Rotate those volumes to another key or back up your keyring first—deleting a key without a backup makes bound volumes unrecoverable.`
            : `Removes "${pendingDeleteLocalKey?.label ?? ''}" (${pendingDeleteLocalKey?.fingerprint ?? ''}) from this browser's keyring.`
        }
        details={
          pendingDeleteBoundBooks.length > 0
            ? pendingDeleteBoundBooks.map((b) => `${b.title} (${b.format})`)
            : undefined
        }
        confirmLabel="Delete Key"
        destructive={true}
        onCancel={() => setPendingDeleteLocalKey(null)}
        onConfirm={() => {
          const target = pendingDeleteLocalKey;
          setPendingDeleteLocalKey(null);
          if (target) {
            void onDeleteLocalKey(target.keyId);
          }
        }}
      />
    </div>
  );
}
