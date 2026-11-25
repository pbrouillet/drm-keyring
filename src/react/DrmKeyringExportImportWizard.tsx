import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileKey2,
  KeyRound,
  Upload,
  X,
} from 'lucide-react';
import { MIN_DRM_PASSPHRASE_LENGTH } from '../constants.js';
import { parseDrmKeyringBackupJson } from '../keyringCrypto.js';
import type { DrmKeyringEncryptedBackup, DrmManagedKey } from '../types.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';

export type KeyringWizardMode = 'export' | 'import';

export interface DrmKeyringExportImportWizardProps {
  localKeys: DrmManagedKey[];
  initialMode?: KeyringWizardMode;
  appName?: string;
  onClose?: () => void;
  onExportEncryptedBackup: (
    backupPassphrase: string,
    backupHint: string
  ) => Promise<{ backup: DrmKeyringEncryptedBackup; fileName: string }>;
  onImportEncryptedBackup: (
    rawJson: string,
    backupPassphrase: string,
    strategy: 'merge' | 'replace'
  ) => Promise<{ restoredCount: number; totalKeyCount: number }>;
  onRedownloadSealedBackup?: (backup: DrmKeyringEncryptedBackup, fileName: string) => void;
  onOpenDrmKeyVault?: () => void;
}

export const DrmKeyringExportImportWizard: React.FC<DrmKeyringExportImportWizardProps> = ({
  localKeys,
  initialMode = 'export',
  appName = 'Nocturne',
  onClose,
  onExportEncryptedBackup,
  onImportEncryptedBackup,
  onRedownloadSealedBackup,
  onOpenDrmKeyVault,
}) => {
  const [mode, setMode] = useState<KeyringWizardMode>(initialMode);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  // Export Wizard State (Steps 1 -> 2 -> 3)
  const [exportStep, setExportStep] = useState<1 | 2 | 3>(1);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportConfirmPassphrase, setExportConfirmPassphrase] = useState('');
  const [exportHint, setExportHint] = useState('');
  const [showExportPassphrase, setShowExportPassphrase] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [sealedExportReceipt, setSealedExportReceipt] = useState<{
    backup: DrmKeyringEncryptedBackup;
    fileName: string;
  } | null>(null);

  // Import Wizard State (Steps 1 -> 2 -> 3)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [importStep, setImportStep] = useState<1 | 2 | 3>(1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [loadedRawJson, setLoadedRawJson] = useState<string>('');
  const [parsedPreview, setParsedPreview] = useState<DrmKeyringEncryptedBackup | null>(null);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [showImportPassphrase, setShowImportPassphrase] = useState(false);
  const [importStrategy, setImportStrategy] = useState<'merge' | 'replace'>('merge');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const [recoveryReceipt, setRecoveryReceipt] = useState<{
    restoredCount: number;
    totalKeyCount: number;
    backupId: string;
    fingerprints: string[];
  } | null>(null);

  const activeKeyCount = localKeys.filter((k) => k.status === 'active').length;
  const retiredKeyCount = localKeys.filter((k) => k.status === 'retired').length;

  const resetExportWizard = () => {
    setExportStep(1);
    setExportPassphrase('');
    setExportConfirmPassphrase('');
    setExportHint('');
    setShowExportPassphrase(false);
    setExportError(null);
    setSealedExportReceipt(null);
  };

  const resetImportWizard = () => {
    setImportStep(1);
    setLoadedFileName('');
    setLoadedRawJson('');
    setParsedPreview(null);
    setImportPassphrase('');
    setShowImportPassphrase(false);
    setImportStrategy('merge');
    setImportError(null);
    setRecoveryReceipt(null);
  };

  const handleSealAndDownloadExport = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportError(null);

    if (localKeys.length === 0) {
      setExportError('Create at least one DRM key before exporting a backup file.');
      return;
    }
    if (!exportPassphrase || exportPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
      setExportError(
        `Backup passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`
      );
      return;
    }
    if (exportPassphrase !== exportConfirmPassphrase) {
      setExportError('Backup passphrase confirmation does not match.');
      return;
    }
    const cleanHint = exportHint.trim();
    if (cleanHint && cleanHint.toLowerCase() === exportPassphrase.trim().toLowerCase()) {
      setExportError('Never enter your actual backup passphrase inside the hint field.');
      return;
    }

    setIsExporting(true);
    try {
      const receipt = await onExportEncryptedBackup(exportPassphrase, cleanHint);
      setExportPassphrase('');
      setExportConfirmPassphrase('');
      setShowExportPassphrase(false);
      setSealedExportReceipt(receipt);
      setExportStep(3);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Failed to seal local keyring backup.');
    } finally {
      setIsExporting(false);
    }
  };

  const ingestBackupFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const parsed = parseDrmKeyringBackupJson(text);
      setLoadedFileName(file.name);
      setLoadedRawJson(text);
      setParsedPreview(parsed);
      setImportStep(2);
    } catch (err) {
      setLoadedFileName('');
      setLoadedRawJson('');
      setParsedPreview(null);
      setImportError(
        err instanceof Error
          ? err.message
          : `Selected file is not a valid ${appName} .nkey.json keyring backup.`
      );
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (picked) {
      void ingestBackupFile(picked);
    }
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) {
      void ingestBackupFile(dropped);
    }
  };

  const executeDecryptAndImport = async () => {
    if (!parsedPreview || !loadedRawJson) return;
    setImportError(null);

    if (!importPassphrase) {
      setImportError('Enter the Backup Passphrase used when this .nkey.json file was created.');
      return;
    }

    setIsImporting(true);
    try {
      const res = await onImportEncryptedBackup(loadedRawJson, importPassphrase, importStrategy);
      setImportPassphrase('');
      setShowImportPassphrase(false);
      setRecoveryReceipt({
        restoredCount: res.restoredCount,
        totalKeyCount: res.totalKeyCount,
        backupId: parsedPreview.backupId,
        fingerprints: parsedPreview.keyFingerprints,
      });
      setImportStep(3);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Incorrect passphrase or corrupted backup file.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleSubmitImportForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!importPassphrase) {
      setImportError('Enter the Backup Passphrase used when this .nkey.json file was created.');
      return;
    }
    if (importStrategy === 'replace' && localKeys.length > 0) {
      setConfirmReplaceOpen(true);
      return;
    }
    void executeDecryptAndImport();
  };

  const activeStep = mode === 'export' ? exportStep : importStep;
  const stepLabels =
    mode === 'export'
      ? ['01. Inspect Keyring', '02. Seal with Passphrase', '03. Download Receipt']
      : ['01. Select Backup File', '02. Decrypt & Strategy', '03. Recovery Complete'];

  return (
    <section
      aria-labelledby="keyring-wizard-heading"
      className={
        onClose
          ? 'space-y-5'
          : 'space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]'
      }
    >
      {/* Header, Mode Switcher & Optional Close */}
      <div className="flex flex-col gap-3.5 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between dark:border-[#1E2536]">
        <div className="flex min-w-0 items-start gap-2.5">
          <FileKey2 className="mt-0.5 h-5 w-5 shrink-0 text-[#E5A93C]" aria-hidden="true" />
          <div className="min-w-0">
            <h2
              id="keyring-wizard-heading"
              className="font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]"
            >
              DRM Keyring Backup &amp; Recovery
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Export an <span className="font-mono">AES-256-GCM</span> encrypted{' '}
              <span className="font-mono">.nkey.json</span> bundle to physical storage or recover it
              on another device.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end shrink-0">
          <div
            role="tablist"
            aria-label="Keyring backup wizard mode"
            className="grid flex-1 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex-initial dark:border-[#252E42] dark:bg-[#0E121B]"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'export'}
              onClick={() => {
                setMode('export');
                setExportError(null);
              }}
              className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap ${
                mode === 'export'
                  ? 'bg-[#E5A93C] text-[#0B0D13]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Export</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'import'}
              onClick={() => {
                setMode('import');
                setImportError(null);
              }}
              className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap ${
                mode === 'import'
                  ? 'bg-[#E5A93C] text-[#0B0D13]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import</span>
            </button>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              disabled={isExporting || isImporting}
              aria-label="Close keyring backup wizard"
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 3-Step Editorial Progress Strip */}
      <ol
        aria-label="Wizard steps"
        className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-3.5 sm:grid-cols-3 dark:border-[#1B2130]"
      >
        {stepLabels.map((label, idx) => {
          const stepNum = (idx + 1) as 1 | 2 | 3;
          const isCurrent = activeStep === stepNum;
          const isComplete = activeStep > stepNum;
          return (
            <li
              key={label}
              className={`flex items-center justify-between border-b-2 pb-1.5 font-mono text-xs tabular-nums ${
                isCurrent
                  ? 'border-b-[#E5A93C] font-semibold text-slate-900 dark:text-[#E8ECF4]'
                  : isComplete
                  ? 'border-b-emerald-500 text-emerald-700 dark:text-emerald-400'
                  : 'border-b-transparent text-slate-400 dark:text-slate-500'
              }`}
            >
              <span>{label}</span>
              {isComplete && (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>

      {/* ===================================================================== */}
      {/* EXPORT WIZARD                                                         */}
      {/* ===================================================================== */}
      {mode === 'export' && (
        <div>
          {exportError && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {exportError}
            </p>
          )}

          {exportStep === 1 && (
            <div className="space-y-4">
              {localKeys.length === 0 ? (
                <div className="space-y-3 py-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]">
                    No Managed DRM Keys Found on This Device
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Create a Managed DRM Key in the Key Vault before exporting a backup, or switch
                    to <strong>Import</strong> above to restore an existing{' '}
                    <span className="font-mono">.nkey.json</span> file onto this device.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {onOpenDrmKeyVault && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose?.();
                          onOpenDrmKeyVault();
                        }}
                        className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] whitespace-nowrap"
                      >
                        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Open DRM Key Vault</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setMode('import')}
                      className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Switch to Import</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Keys included in encrypted backup bundle
                    </span>
                    <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {activeKeyCount} active · {retiredKeyCount} retired · {localKeys.length} total
                    </span>
                  </div>

                  <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto border-y border-slate-200 dark:divide-[#1B2130] dark:border-[#1E2536]">
                    {localKeys.map((k) => (
                      <div
                        key={k.keyId}
                        className="flex flex-col gap-1 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                            {k.label}
                          </span>
                          <span className="ml-2 font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                            v{k.generation} · {k.status}
                            {k.isDefault ? ' · default' : ''}
                          </span>
                        </div>
                        <span className="font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                          {k.fingerprint}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setExportError(null);
                        setExportStep(2);
                      }}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[40px] sm:w-auto whitespace-nowrap"
                    >
                      <span>Continue to Passphrase Sealing</span>
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {exportStep === 2 && (
            <form onSubmit={handleSealAndDownloadExport} className="space-y-4">
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Choose a strong Backup Passphrase to seal the outer{' '}
                <span className="font-mono">.nkey.json</span> file via{' '}
                <span className="font-mono">PBKDF2-SHA256</span> (210,000 iterations) +{' '}
                <span className="font-mono">AES-256-GCM</span>. You will need this passphrase when
                importing the file onto a new device.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="wizard-export-passphrase"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Backup Passphrase
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="wizard-export-passphrase"
                      type={showExportPassphrase ? 'text' : 'password'}
                      autoComplete="off"
                      value={exportPassphrase}
                      onChange={(e) => setExportPassphrase(e.target.value)}
                      placeholder={`At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`}
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowExportPassphrase((v) => !v)}
                      aria-label={showExportPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      {showExportPassphrase ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="wizard-export-confirm"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Confirm Backup Passphrase
                  </label>
                  <input
                    id="wizard-export-confirm"
                    type={showExportPassphrase ? 'text' : 'password'}
                    autoComplete="off"
                    value={exportConfirmPassphrase}
                    onChange={(e) => setExportConfirmPassphrase(e.target.value)}
                    placeholder="Re-enter Backup Passphrase"
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="wizard-export-hint"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Optional Non-Secret Backup Hint
                </label>
                <input
                  id="wizard-export-hint"
                  type="text"
                  maxLength={80}
                  value={exportHint}
                  onChange={(e) => setExportHint(e.target.value)}
                  placeholder="e.g., Printed on physical recovery card in desk safe"
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                />
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]">
                <button
                  type="button"
                  onClick={() => {
                    setExportError(null);
                    setExportStep(1);
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back</span>
                </button>

                <button
                  type="submit"
                  disabled={isExporting}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isExporting ? 'Encrypting Keyring...' : 'Seal & Download .nkey.json'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {exportStep === 3 && sealedExportReceipt && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-slate-800 dark:text-slate-200">
                <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Encrypted Backup Downloaded to Physical Storage</span>
                </div>
                <div className="mt-2 space-y-1 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums">
                  <div>File: {sealedExportReceipt.fileName}</div>
                  <div>
                    Backup ID: {sealedExportReceipt.backup.backupId} · Keys:{' '}
                    {sealedExportReceipt.backup.keyCount} · Cipher:{' '}
                    {sealedExportReceipt.backup.cipher}
                  </div>
                  <div>
                    Fingerprints: {sealedExportReceipt.backup.keyFingerprints.join(', ')}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]">
                <div className="flex flex-wrap items-center gap-2">
                  {onRedownloadSealedBackup && (
                    <button
                      type="button"
                      onClick={() =>
                        onRedownloadSealedBackup(
                          sealedExportReceipt.backup,
                          sealedExportReceipt.fileName
                        )
                      }
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download Again</span>
                    </button>
                  )}

                  {onClose && (
                    <button
                      type="button"
                      onClick={resetExportWizard}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                    >
                      New Export
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    resetExportWizard();
                    onClose?.();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap"
                >
                  <span>{onClose ? 'Done' : 'Done / Start New Export'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* IMPORT / RECOVERY WIZARD                                              */}
      {/* ===================================================================== */}
      {mode === 'import' && (
        <div>
          {importError && (
            <p className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
              {importError}
            </p>
          )}

          {importStep === 1 && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.nkey.json,application/json"
                onChange={handleFileInputChange}
                className="hidden"
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDropFile}
                className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${
                  isDragOver
                    ? 'border-[#E5A93C] bg-[#E5A93C]/10'
                    : 'border-slate-300 bg-slate-50/50 dark:border-[#283248] dark:bg-[#0D1018]'
                }`}
              >
                <Upload className="h-6 w-6 text-[#E5A93C]" aria-hidden="true" />
                <p className="mt-2 text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  Drop your encrypted <span className="font-mono">.nkey.json</span> keyring backup
                  here
                </p>
                <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  {appName} inspects the authenticated header metadata locally before prompting for
                  your Backup Passphrase.
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose .nkey.json File</span>
                </button>
              </div>
            </div>
          )}

          {importStep === 2 && parsedPreview && (
            <form onSubmit={handleSubmitImportForm} className="space-y-4">
              <div className="border-b border-slate-200 pb-3.5 text-xs dark:border-[#1E2536]">
                <div className="font-semibold text-slate-900 dark:text-[#E8ECF4]">
                  Verified Backup Envelope · <span className="font-mono">{loadedFileName}</span>
                </div>
                <div className="mt-1.5 space-y-1 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  <div>
                    Backup ID: {parsedPreview.backupId} · Created{' '}
                    {new Date(parsedPreview.createdAt).toLocaleString()}
                  </div>
                  <div>
                    Contains {parsedPreview.keyCount}{' '}
                    {parsedPreview.keyCount === 1 ? 'Managed DRM Key' : 'Managed DRM Keys'} ·{' '}
                    {parsedPreview.kdf} ({parsedPreview.iterations.toLocaleString()} iter)
                  </div>
                  <div>Fingerprints: {parsedPreview.keyFingerprints.join(', ')}</div>
                  {parsedPreview.backupHint && (
                    <div className="font-sans text-slate-700 dark:text-slate-300">
                      Backup Hint: <strong>{parsedPreview.backupHint}</strong>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="wizard-import-passphrase"
                    className="block text-xs font-medium text-slate-700 dark:text-slate-300"
                  >
                    Backup Passphrase
                  </label>
                  <div className="relative mt-1">
                    <input
                      id="wizard-import-passphrase"
                      type={showImportPassphrase ? 'text' : 'password'}
                      autoComplete="off"
                      value={importPassphrase}
                      onChange={(e) => setImportPassphrase(e.target.value)}
                      placeholder="Enter Backup Passphrase"
                      className="min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowImportPassphrase((v) => !v)}
                      aria-label={showImportPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                      className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      {showImportPassphrase ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Keyring Recovery Strategy
                  </span>
                  <div className="mt-1 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setImportStrategy('merge')}
                      className={`min-h-[42px] rounded-lg border px-3 py-1.5 text-center text-xs transition-colors whitespace-nowrap ${
                        importStrategy === 'merge'
                          ? 'border-[#E5A93C] bg-[#E5A93C]/15 font-semibold text-slate-900 dark:text-[#E5A93C]'
                          : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'
                      }`}
                    >
                      Merge Keys
                    </button>
                    <button
                      type="button"
                      onClick={() => setImportStrategy('replace')}
                      className={`min-h-[42px] rounded-lg border px-3 py-1.5 text-center text-xs transition-colors whitespace-nowrap ${
                        importStrategy === 'replace'
                          ? 'border-red-500/60 bg-red-500/10 font-semibold text-red-700 dark:text-red-300'
                          : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'
                      }`}
                    >
                      Replace Local
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]">
                <button
                  type="button"
                  onClick={resetImportWizard}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Choose Different File</span>
                </button>

                <button
                  type="submit"
                  disabled={isImporting}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap"
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {isImporting ? 'Verifying & Restoring...' : 'Decrypt & Recover Keyring'}
                  </span>
                </button>
              </div>
            </form>
          )}

          {importStep === 3 && recoveryReceipt && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-slate-800 dark:text-slate-200">
                <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>DRM Keyring Recovered to Browser IndexedDB</span>
                </div>
                <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300">
                  Verified AES-256-GCM authenticity tag and imported{' '}
                  <strong>{recoveryReceipt.restoredCount}</strong>{' '}
                  {recoveryReceipt.restoredCount === 1 ? 'key' : 'keys'}. Your device now holds{' '}
                  <strong>{recoveryReceipt.totalKeyCount}</strong> Managed DRM{' '}
                  {recoveryReceipt.totalKeyCount === 1 ? 'Key' : 'Keys'} ready to unlock encrypted{' '}
                  <span className="font-mono">.ndrm</span> volumes immediately.
                </p>
                <div className="mt-2 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                  Restored Fingerprints: {recoveryReceipt.fingerprints.join(', ')}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-[#1B2130]">
                <div className="flex flex-wrap items-center gap-2">
                  {onOpenDrmKeyVault && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onOpenDrmKeyVault();
                      }}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                    >
                      <KeyRound className="h-3.5 w-3.5 text-[#E5A93C]" aria-hidden="true" />
                      <span>Inspect Keys in Vault</span>
                    </button>
                  )}
                  {onClose && (
                    <button
                      type="button"
                      onClick={resetImportWizard}
                      className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap"
                    >
                      Import Another File
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    resetImportWizard();
                    onClose?.();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap"
                >
                  <span>{onClose ? 'Done' : 'Done / Import Another File'}</span>
                </button>
              </div>
            </div>
          )}

          <KeyringConfirmDialog
            open={confirmReplaceOpen}
            title="Replace Existing Local DRM Keys?"
            description={`This device currently stores ${localKeys.length} Managed DRM ${
              localKeys.length === 1 ? 'Key' : 'Keys'
            }. Replacing your local keyring will remove any local keys not present in this backup file. Choose "Merge Keys" instead unless you intend to overwrite them.`}
            confirmLabel="Replace Local Keyring"
            onCancel={() => setConfirmReplaceOpen(false)}
            onConfirm={() => {
              setConfirmReplaceOpen(false);
              void executeDecryptAndImport();
            }}
          />
        </div>
      )}
    </section>
  );
};
