import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useRef, useState } from 'react';
import { Check, Cloud, Download, Eye, EyeOff, KeyRound, Loader2, Plus, RefreshCw, RotateCw, ShieldCheck, Trash2, Upload, X, } from 'lucide-react';
import { DEFAULT_KEYRING_FILENAME, MAX_DRM_HINT_LENGTH, MAX_DRM_KEY_LABEL_LENGTH, MIN_DRM_PASSPHRASE_LENGTH, } from '../constants.js';
import { formatBytes } from '../utils.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';
function formatDateTimeShort(epochOrIso) {
    const ts = typeof epochOrIso === 'number' ? epochOrIso : Date.parse(epochOrIso);
    if (!Number.isFinite(ts) || ts <= 0)
        return 'Unknown date';
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(ts));
}
export function DrmKeyVaultPanel({ drmKeys, items, libraryBooks, isDriveConnected, isDriveSessionLive = isDriveConnected, isSigningIn = false, remoteDriveBackup, isInspectingDriveBackup, providerLabel = 'Google Drive', remoteFileName = DEFAULT_KEYRING_FILENAME, renderConnectButton, onConnectDrive, onRefreshDriveBackupStatus, onCreateKey, onRotateKey, onSetDefaultKey, onDeleteLocalKey, onBackupKeyringToDrive, onRestoreKeyringFromDrive, onDeleteDriveKeyringBackup, onExportLocalKeyringFile, onImportLocalKeyringFile, }) {
    const effectiveItems = items ?? libraryBooks ?? [];
    // --- 1. Create New Managed Key Form State ---
    const [newLabel, setNewLabel] = useState('');
    const [newPassphrase, setNewPassphrase] = useState('');
    const [newConfirmPassphrase, setNewConfirmPassphrase] = useState('');
    const [newHint, setNewHint] = useState('');
    const [newSetDefault, setNewSetDefault] = useState(true);
    const [showNewPass, setShowNewPass] = useState(false);
    const [isCreatingKey, setIsCreatingKey] = useState(false);
    const [createKeyError, setCreateKeyError] = useState(null);
    const [createKeySuccess, setCreateKeySuccess] = useState(null);
    // --- 2. Rotate Key Inline Drawer State ---
    const [rotatingKeyId, setRotatingKeyId] = useState(null);
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
    const [rotateError, setRotateError] = useState(null);
    // --- 3. Cloud & Portable Backup / Restore State ---
    const [cloudTab, setCloudTab] = useState('BACKUP');
    const [backupPassphrase, setBackupPassphrase] = useState('');
    const [backupConfirmPassphrase, setBackupConfirmPassphrase] = useState('');
    const [backupHint, setBackupHint] = useState('');
    const [showBackupPass, setShowBackupPass] = useState(false);
    const [restorePassphrase, setRestorePassphrase] = useState('');
    const [restoreStrategy, setRestoreStrategy] = useState('merge');
    const [showRestorePass, setShowRestorePass] = useState(false);
    const [pendingPortableJson, setPendingPortableJson] = useState(null);
    const [isCloudBusy, setIsCloudBusy] = useState(false);
    const [cloudFeedback, setCloudFeedback] = useState(null);
    // --- 4. Explicit User Confirmation Modals ---
    const [confirmOverwriteDriveOpen, setConfirmOverwriteDriveOpen] = useState(false);
    const [confirmDeleteDriveOpen, setConfirmDeleteDriveOpen] = useState(false);
    const [confirmReplaceLocalOpen, setConfirmReplaceLocalOpen] = useState(null);
    const [pendingDeleteLocalKey, setPendingDeleteLocalKey] = useState(null);
    const portableFileInputRef = useRef(null);
    const boundBooksByKeyId = useMemo(() => {
        const map = new Map();
        for (const item of effectiveItems) {
            const kId = item.drm?.keyId;
            if (!kId)
                continue;
            const list = map.get(kId) ?? [];
            list.push(item);
            map.set(kId, list);
        }
        return map;
    }, [effectiveItems]);
    const activeKeysCount = useMemo(() => drmKeys.filter((k) => k.status === 'active').length, [drmKeys]);
    const rotatingKey = useMemo(() => drmKeys.find((k) => k.keyId === rotatingKeyId) ?? null, [drmKeys, rotatingKeyId]);
    const rotatingBoundLocalBooks = useMemo(() => {
        if (!rotatingKey)
            return [];
        return (boundBooksByKeyId.get(rotatingKey.keyId) ?? []).filter((b) => b.source === 'local');
    }, [boundBooksByKeyId, rotatingKey]);
    const openRotateDrawer = (key) => {
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
    const handleCreateKeySubmit = async (e) => {
        e.preventDefault();
        setCreateKeyError(null);
        setCreateKeySuccess(null);
        const cleanLabel = newLabel.trim().slice(0, MAX_DRM_KEY_LABEL_LENGTH);
        if (!cleanLabel) {
            setCreateKeyError('Enter a descriptive key label (e.g. "Primary Archive Key").');
            return;
        }
        if (newPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
            setCreateKeyError(`Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
            return;
        }
        if (newPassphrase !== newConfirmPassphrase) {
            setCreateKeyError('Passphrase and confirmation do not match.');
            return;
        }
        if (newHint.trim() &&
            newHint.trim().toLowerCase() === newPassphrase.trim().toLowerCase()) {
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
        }
        catch (err) {
            setCreateKeyError(err instanceof Error ? err.message : 'Failed to create Managed DRM key.');
        }
        finally {
            setIsCreatingKey(false);
        }
    };
    const handleRotateSubmit = async (e) => {
        e.preventDefault();
        if (!rotatingKey)
            return;
        setRotateError(null);
        if (!rotCurrentPass) {
            setRotateError('Enter the current passphrase for this key to authorize rotation.');
            return;
        }
        if (rotChangePass) {
            if (rotNewPass.length < MIN_DRM_PASSPHRASE_LENGTH) {
                setRotateError(`New passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
                return;
            }
            if (rotNewPass !== rotConfirmNewPass) {
                setRotateError('New passphrase confirmation does not match.');
                return;
            }
        }
        const candidatePass = rotChangePass ? rotNewPass : rotCurrentPass;
        if (rotNewHint.trim() &&
            rotNewHint.trim().toLowerCase() === candidatePass.trim().toLowerCase()) {
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
        }
        catch (err) {
            setRotateError(err instanceof Error ? err.message : 'Failed to rotate DRM key.');
        }
        finally {
            setIsRotating(false);
        }
    };
    const validateBackupInputs = () => {
        if (drmKeys.length === 0) {
            return 'Create at least one Managed DRM key before backing up your keyring.';
        }
        if (backupPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
            return `Backup passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`;
        }
        if (backupPassphrase !== backupConfirmPassphrase) {
            return 'Backup passphrase confirmation does not match.';
        }
        if (backupHint.trim() &&
            backupHint.trim().toLowerCase() === backupPassphrase.trim().toLowerCase()) {
            return 'Never write your backup passphrase inside the optional hint field.';
        }
        return null;
    };
    const executeDriveBackupNow = async () => {
        setIsCloudBusy(true);
        setCloudFeedback(null);
        try {
            await onBackupKeyringToDrive(backupPassphrase, backupHint.trim().slice(0, MAX_DRM_HINT_LENGTH));
            setBackupPassphrase('');
            setBackupConfirmPassphrase('');
            setCloudFeedback({
                tone: 'success',
                text: `Encrypted ${drmKeys.length} ${drmKeys.length === 1 ? 'key' : 'keys'} with AES-256-GCM and backed up to your ${providerLabel} appDataFolder.`,
            });
        }
        catch (err) {
            setCloudFeedback({
                tone: 'error',
                text: err instanceof Error ? err.message : `${providerLabel} keyring backup failed.`,
            });
        }
        finally {
            setIsCloudBusy(false);
        }
    };
    const handleRequestDriveBackup = (e) => {
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
            await onExportLocalKeyringFile(backupPassphrase, backupHint.trim().slice(0, MAX_DRM_HINT_LENGTH));
            setCloudFeedback({
                tone: 'success',
                text: 'Downloaded encrypted .nkey.json keyring backup file.',
            });
        }
        catch (e) {
            setCloudFeedback({
                tone: 'error',
                text: e instanceof Error ? e.message : 'Failed to export portable keyring file.',
            });
        }
        finally {
            setIsCloudBusy(false);
        }
    };
    const executeRestoreFromDriveNow = async () => {
        setIsCloudBusy(true);
        setCloudFeedback(null);
        try {
            const { restoredCount } = await onRestoreKeyringFromDrive(restorePassphrase, restoreStrategy);
            setRestorePassphrase('');
            setCloudFeedback({
                tone: 'success',
                text: `Restored ${restoredCount} Managed DRM ${restoredCount === 1 ? 'key' : 'keys'} from ${providerLabel}.`,
            });
        }
        catch (err) {
            setCloudFeedback({
                tone: 'error',
                text: err instanceof Error
                    ? err.message
                    : `Failed to restore keyring from ${providerLabel}.`,
            });
        }
        finally {
            setIsCloudBusy(false);
        }
    };
    const executeRestoreFromFileNow = async () => {
        if (!pendingPortableJson)
            return;
        setIsCloudBusy(true);
        setCloudFeedback(null);
        try {
            const { restoredCount } = await onImportLocalKeyringFile(pendingPortableJson.rawJson, restorePassphrase, restoreStrategy);
            setRestorePassphrase('');
            setPendingPortableJson(null);
            setCloudFeedback({
                tone: 'success',
                text: `Restored ${restoredCount} Managed DRM ${restoredCount === 1 ? 'key' : 'keys'} from portable backup file.`,
            });
        }
        catch (err) {
            setCloudFeedback({
                tone: 'error',
                text: err instanceof Error ? err.message : 'Failed to import portable keyring file.',
            });
        }
        finally {
            setIsCloudBusy(false);
        }
    };
    const handleRequestDriveRestore = (e) => {
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
    const handlePortableFileChange = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file)
            return;
        try {
            const rawJson = await file.text();
            setPendingPortableJson({ fileName: file.name, rawJson });
            setCloudTab('RESTORE');
            setCloudFeedback(null);
        }
        catch {
            setCloudFeedback({
                tone: 'error',
                text: 'Unable to read selected keyring backup file.',
            });
        }
    };
    const pendingDeleteBoundBooks = pendingDeleteLocalKey
        ? boundBooksByKeyId.get(pendingDeleteLocalKey.keyId) ?? []
        : [];
    const connectButtonNode = renderConnectButton ? (renderConnectButton()) : (_jsxs("button", { type: "button", disabled: isSigningIn, onClick: onConnectDrive, className: "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:border-[#283248] dark:bg-[#121620] dark:text-slate-100 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Cloud, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: isSigningIn ? 'Connecting...' : `Connect ${providerLabel}` })] }));
    return (_jsxs("div", { className: "grid grid-cols-1 gap-6 sm:gap-8 lg:grid-cols-12 items-start", children: [_jsxs("div", { className: "space-y-5 sm:space-y-6 lg:col-span-7", children: [_jsxs("section", { "aria-labelledby": "drm-keyring-inventory-heading", className: "rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]", children: [_jsx("div", { className: "flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4 dark:border-[#1B2130]", children: _jsxs("div", { children: [_jsx("h2", { id: "drm-keyring-inventory-heading", className: "font-display text-lg font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "Managed DRM Keyring" }), _jsxs("p", { className: "mt-1 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums", children: [activeKeysCount, " Active \u00B7 ", drmKeys.length - activeKeysCount, " Retired \u00B7 Wrapped at rest (PBKDF2-SHA256 + AES-256-GCM)"] })] }) }), drmKeys.length === 0 ? (_jsxs("div", { className: "py-8 text-center sm:py-10", children: [_jsx(KeyRound, { className: "mx-auto h-8 w-8 text-slate-400 dark:text-slate-500", "aria-hidden": "true" }), _jsx("h3", { className: "mt-3 font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "No Managed DRM Keys Yet" }), _jsxs("p", { className: "mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400", children: ["Create a named 256-bit vault key to encrypt uploads, rotate keys across volumes in milliseconds without exposing plaintext on disk, and back up or restore your encrypted keyring via ", providerLabel, "."] })] })) : (_jsx("div", { className: "divide-y divide-slate-100 dark:divide-[#1B2130]", children: drmKeys.map((key) => {
                                    const boundBooks = boundBooksByKeyId.get(key.keyId) ?? [];
                                    const isRotOpen = rotatingKeyId === key.keyId;
                                    return (_jsxs("div", { className: "py-4 first:pt-4 last:pb-0", children: [_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", children: [_jsxs("div", { className: "min-w-0 flex-1", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("span", { className: "font-display text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]", children: key.label }), _jsxs("span", { className: "font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums", children: ["\u00B7 v", key.generation] }), key.status === 'active' ? (_jsxs("span", { className: "font-mono text-xs font-medium text-emerald-700 dark:text-emerald-400", children: ["\u00B7 Active", key.isDefault ? ' (Default)' : ''] })) : (_jsx("span", { className: "font-mono text-xs text-slate-500 dark:text-slate-400", children: "\u00B7 Retired" }))] }), _jsxs("div", { className: "mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums", children: [_jsx("span", { title: "SHA-256 key fingerprint", className: "break-all sm:break-normal", children: key.fingerprint }), _jsx("span", { "aria-hidden": "true", children: "\u00B7" }), _jsxs("span", { children: [boundBooks.length, ' ', boundBooks.length === 1 ? 'volume' : 'volumes'] }), _jsx("span", { "aria-hidden": "true", children: "\u00B7" }), _jsxs("span", { children: ["Created ", formatDateTimeShort(key.createdAt)] }), key.rotatedAt && (_jsxs(_Fragment, { children: [_jsx("span", { "aria-hidden": "true", children: "\u00B7" }), _jsxs("span", { children: ["Rotated ", formatDateTimeShort(key.rotatedAt)] })] }))] }), key.keyHint && (_jsxs("p", { className: "mt-1 text-xs text-slate-500 dark:text-slate-400", children: ["Hint: ", key.keyHint] }))] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 sm:gap-1.5 shrink-0", children: [key.status === 'active' && !key.isDefault && (_jsx("button", { type: "button", onClick: () => void onSetDefaultKey(key.keyId), className: "min-h-[42px] rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 sm:min-h-[34px] sm:px-2.5 dark:border-[#252E42] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0", children: "Set Default" })), key.status === 'active' && (_jsxs("button", { type: "button", onClick: () => isRotOpen ? setRotatingKeyId(null) : openRotateDrawer(key), className: `inline-flex min-h-[42px] items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap shrink-0 ${isRotOpen
                                                                    ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                                                                    : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-[#252E42] dark:text-slate-200 dark:hover:bg-[#1B2232]'}`, children: [_jsx(RotateCw, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: isRotOpen ? 'Close Rotate' : 'Rotate Key' })] })), _jsx("button", { type: "button", onClick: () => setPendingDeleteLocalKey(key), "aria-label": `Delete key ${key.label}`, title: "Delete key from local keyring", className: "flex min-h-[42px] min-w-[42px] items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:border-red-400 hover:text-red-500 sm:min-h-[34px] sm:min-w-[34px] dark:border-[#252E42] dark:text-slate-400", children: _jsx(Trash2, { className: "h-3.5 w-3.5", "aria-hidden": "true" }) })] })] }), isRotOpen && rotatingKey && (_jsxs("form", { onSubmit: (e) => void handleRotateSubmit(e), className: "mt-4 space-y-3.5 border-t border-slate-100 pt-4 dark:border-[#1E2536]", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsxs("h4", { className: "font-display text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Rotate \u201C", rotatingKey.label, "\u201D (v", rotatingKey.generation, " \u2192 v", rotatingKey.generation + 1, ")"] }), _jsx("button", { type: "button", onClick: () => setRotatingKeyId(null), className: "text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]", children: "Cancel" })] }), _jsxs("p", { className: "text-xs leading-relaxed text-slate-600 dark:text-slate-400", children: ["Generates a fresh 256-bit AES key, marks", ' ', _jsx("code", { className: "break-all font-mono sm:break-normal", children: rotatingKey.fingerprint }), ' ', "as retired (kept in keyring so older exported", ' ', _jsx("code", { className: "font-mono", children: ".ndrm" }), " files remain readable), and re-wraps local volumes in RAM."] }), rotateError && (_jsx("div", { role: "alert", className: "rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300", children: rotateError })), _jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: `rot-cur-pass-${key.keyId}`, className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Current Key Passphrase" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: `rot-cur-pass-${key.keyId}`, type: showRotPass ? 'text' : 'password', autoComplete: "current-password", disabled: isRotating, value: rotCurrentPass, onChange: (e) => setRotCurrentPass(e.target.value), placeholder: "Authorize current key...", className: "min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", tabIndex: -1, onClick: () => setShowRotPass((s) => !s), "aria-label": showRotPass ? 'Hide passphrase' : 'Show passphrase', className: "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200", children: showRotPass ? (_jsx(EyeOff, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: `rot-label-${key.keyId}`, className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Rotated Key Label" }), _jsx("input", { id: `rot-label-${key.keyId}`, type: "text", maxLength: MAX_DRM_KEY_LABEL_LENGTH, disabled: isRotating, value: rotNewLabel, onChange: (e) => setRotNewLabel(e.target.value), className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] })] }), _jsxs("label", { className: "flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300", children: [_jsx("input", { type: "checkbox", checked: rotChangePass, onChange: (e) => setRotChangePass(e.target.checked), className: "h-4 w-4 rounded accent-[#E5A93C]" }), _jsx("span", { children: "Also change the unlock passphrase on the new key generation" })] }), rotChangePass && (_jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsxs("label", { htmlFor: `rot-new-pass-${key.keyId}`, className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: ["New Passphrase (min ", MIN_DRM_PASSPHRASE_LENGTH, " chars)"] }), _jsx("input", { id: `rot-new-pass-${key.keyId}`, type: showRotPass ? 'text' : 'password', autoComplete: "new-password", disabled: isRotating, value: rotNewPass, onChange: (e) => setRotNewPass(e.target.value), placeholder: "New passphrase...", className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: `rot-confirm-pass-${key.keyId}`, className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm New Passphrase" }), _jsx("input", { id: `rot-confirm-pass-${key.keyId}`, type: showRotPass ? 'text' : 'password', autoComplete: "new-password", disabled: isRotating, value: rotConfirmNewPass, onChange: (e) => setRotConfirmNewPass(e.target.value), placeholder: "Confirm new passphrase...", className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] })] })), _jsxs("div", { children: [_jsx("label", { htmlFor: `rot-hint-${key.keyId}`, className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Optional Non-Secret Hint" }), _jsx("input", { id: `rot-hint-${key.keyId}`, type: "text", maxLength: MAX_DRM_HINT_LENGTH, disabled: isRotating, value: rotNewHint, onChange: (e) => setRotNewHint(e.target.value), placeholder: "Optional memory cue...", className: "mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), rotatingBoundLocalBooks.length > 0 && (_jsxs("div", { className: "space-y-2 pt-1", children: [_jsxs("label", { className: "flex cursor-pointer items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300", children: [_jsx("input", { type: "checkbox", checked: rotRewrapBooks, onChange: (e) => setRotRewrapBooks(e.target.checked), className: "mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]" }), _jsxs("span", { children: ["Re-wrap", ' ', _jsx("strong", { className: "font-mono tabular-nums", children: rotatingBoundLocalBooks.length }), ' ', "local", ' ', rotatingBoundLocalBooks.length === 1 ? 'volume' : 'volumes', " to the new key immediately"] })] }), rotRewrapBooks && (_jsxs("label", { className: "ml-6 flex cursor-pointer items-start gap-2.5 text-xs text-slate-600 dark:text-slate-400", children: [_jsx("input", { type: "checkbox", checked: rotDeepReencrypt, onChange: (e) => setRotDeepReencrypt(e.target.checked), className: "mt-0.5 h-4 w-4 shrink-0 rounded accent-[#E5A93C]" }), _jsx("span", { children: "Deep re-key (also generate fresh per-book DEKs and re-encrypt full archive ciphertext in RAM)" })] }))] })), _jsxs("div", { className: "flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:items-center sm:justify-end", children: [_jsx("button", { type: "button", disabled: isRotating, onClick: () => setRotatingKeyId(null), className: "min-h-[44px] w-full rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[36px] sm:w-auto dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0", children: "Cancel" }), _jsx("button", { type: "submit", disabled: isRotating, className: "inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-4 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] disabled:opacity-60 sm:min-h-[36px] sm:w-auto whitespace-nowrap shrink-0", children: isRotating ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin", "aria-hidden": "true" }), _jsx("span", { children: "Rotating Key..." })] })) : (_jsxs(_Fragment, { children: [_jsx(RotateCw, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Confirm Key Rotation" })] })) })] })] }))] }, key.keyId));
                                }) }))] }), _jsxs("section", { "aria-labelledby": "drm-kms-explainer-heading", className: "rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]", children: [_jsxs("div", { className: "flex items-center gap-2.5", children: [_jsx(ShieldCheck, { className: "h-4 w-4 shrink-0 text-[#C5841A] dark:text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("h3", { id: "drm-kms-explainer-heading", className: "font-display text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Zero-Plaintext Key Lifecycle & ", providerLabel, " Vault Security"] })] }), _jsxs("dl", { className: "mt-4 space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400", children: [_jsxs("div", { children: [_jsx("dt", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "01. Envelope Key Rotation Without Disk Exposure" }), _jsxs("dd", { className: "mt-0.5", children: ["Managed keys are 256-bit random AES-GCM keys stored wrapped under", ' ', _jsx("code", { className: "font-mono", children: "PBKDF2-SHA256" }), " (210k iterations). Rotating a key re-wraps each book's Data-Encryption Key in volatile RAM and zeroes raw key buffers immediately."] })] }), _jsxs("div", { className: "border-t border-slate-100 pt-3 dark:border-[#1B2130]", children: [_jsxs("dt", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["02. Double-Encrypted ", providerLabel, " Backup & Restore"] }), _jsxs("dd", { className: "mt-0.5", children: ["When backing up to ", providerLabel, " (", _jsx("code", { className: "font-mono", children: "appDataFolder" }), "), all wrapped keys are sealed inside a second outer", ' ', _jsx("code", { className: "font-mono", children: "AES-256-GCM" }), " vault encrypted with your Backup Passphrase before leaving your browser."] })] })] })] })] }), _jsxs("aside", { className: "rounded-xl border border-slate-200 bg-white p-4 sm:p-6 lg:col-span-5 dark:border-[#1E2536] dark:bg-[#121620]", children: [_jsxs("form", { onSubmit: (e) => void handleCreateKeySubmit(e), className: "space-y-3.5", children: [_jsxs("div", { children: [_jsx("h3", { className: "font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "Create New DRM Key" }), _jsx("p", { className: "mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400", children: "Generates a random 256-bit AES key wrapped under your passphrase. Raw key bytes are never persisted unencrypted." })] }), createKeyError && (_jsx("div", { role: "alert", className: "rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300", children: createKeyError })), createKeySuccess && (_jsxs("div", { role: "status", className: "flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300", children: [_jsx(Check, { className: "h-3.5 w-3.5 shrink-0", "aria-hidden": "true" }), _jsx("span", { children: createKeySuccess })] })), _jsxs("div", { children: [_jsx("label", { htmlFor: "new-drm-key-label", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Key Name" }), _jsx("input", { id: "new-drm-key-label", type: "text", maxLength: MAX_DRM_KEY_LABEL_LENGTH, disabled: isCreatingKey, value: newLabel, onChange: (e) => setNewLabel(e.target.value), placeholder: "e.g. Primary Archive Key", className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { children: [_jsxs("label", { htmlFor: "new-drm-key-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: ["Key Passphrase (min ", MIN_DRM_PASSPHRASE_LENGTH, " characters)"] }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "new-drm-key-pass", type: showNewPass ? 'text' : 'password', autoComplete: "new-password", disabled: isCreatingKey, value: newPassphrase, onChange: (e) => setNewPassphrase(e.target.value), placeholder: "Choose key unlock passphrase...", className: "min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", tabIndex: -1, onClick: () => setShowNewPass((s) => !s), "aria-label": showNewPass ? 'Hide passphrase' : 'Show passphrase', className: "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200", children: showNewPass ? (_jsx(EyeOff, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "new-drm-key-confirm", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm Passphrase" }), _jsx("input", { id: "new-drm-key-confirm", type: showNewPass ? 'text' : 'password', autoComplete: "new-password", disabled: isCreatingKey, value: newConfirmPassphrase, onChange: (e) => setNewConfirmPassphrase(e.target.value), placeholder: "Re-enter passphrase...", className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "new-drm-key-hint", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Optional Non-Secret Hint" }), _jsx("input", { id: "new-drm-key-hint", type: "text", maxLength: MAX_DRM_HINT_LENGTH, disabled: isCreatingKey, value: newHint, onChange: (e) => setNewHint(e.target.value), placeholder: "Memory cue (never write your passphrase)", className: "mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("label", { className: "flex cursor-pointer items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300", children: [_jsx("input", { type: "checkbox", checked: newSetDefault || activeKeysCount === 0, disabled: activeKeysCount === 0, onChange: (e) => setNewSetDefault(e.target.checked), className: "h-4 w-4 rounded accent-[#E5A93C]" }), _jsx("span", { children: "Set as default key for new encrypted uploads" })] }), _jsx("button", { type: "submit", disabled: isCreatingKey, className: "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-60 sm:min-h-[40px] whitespace-nowrap", children: isCreatingKey ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin", "aria-hidden": "true" }), _jsx("span", { children: "Generating & Wrapping 256-Bit Key..." })] })) : (_jsxs(_Fragment, { children: [_jsx(Plus, { className: "h-4 w-4", "aria-hidden": "true" }), _jsx("span", { children: "Create Managed DRM Key" })] })) })] }), _jsxs("div", { className: "mt-6 border-t border-slate-200 pt-6 dark:border-[#1E2536]", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { children: [_jsxs("h3", { className: "font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]", children: [providerLabel, " Key Backup & Restore"] }), _jsxs("p", { className: "mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400", children: ["Store or recover your encrypted DRM keyring in your private ", providerLabel, ' ', _jsx("code", { className: "font-mono", children: "appDataFolder" }), "."] })] }), isDriveConnected && (_jsx("button", { type: "button", disabled: isInspectingDriveBackup || isCloudBusy, onClick: () => void onRefreshDriveBackupStatus(), "aria-label": `Refresh ${providerLabel} keyring backup status`, title: `Check ${providerLabel} backup status`, className: "flex min-h-[42px] min-w-[42px] shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[34px] sm:min-w-[34px] dark:border-[#252E42] dark:text-slate-300 dark:hover:bg-[#1B2232]", children: _jsx(RefreshCw, { className: `h-3.5 w-3.5 ${isInspectingDriveBackup ? 'animate-spin' : ''}`, "aria-hidden": "true" }) }))] }), _jsx("div", { className: "mt-3 rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs dark:bg-[#0D1018]", children: !isDriveConnected ? (_jsxs("div", { className: "space-y-2.5", children: [_jsxs("p", { className: "text-slate-600 dark:text-slate-400", children: ["Connect ", providerLabel, " to back up or restore your encrypted DRM keyring across devices, or use portable ", _jsx("code", { className: "font-mono", children: ".nkey.json" }), " files offline."] }), connectButtonNode] })) : isInspectingDriveBackup ? (_jsxs("p", { className: "flex items-center gap-2 font-mono text-slate-500 dark:text-slate-400", children: [_jsx(Loader2, { className: "h-3.5 w-3.5 animate-spin text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("span", { children: ["Checking ", providerLabel, " appDataFolder..."] })] })) : remoteDriveBackup ? (_jsxs("div", { className: "space-y-1", children: [_jsxs("div", { className: "flex items-center justify-between gap-2", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "Cloud Keyring Backup Available" }), _jsx("button", { type: "button", disabled: isCloudBusy, onClick: () => setConfirmDeleteDriveOpen(true), className: "text-[11px] font-medium text-red-600 hover:underline dark:text-red-400 whitespace-nowrap", children: "Delete Cloud Backup" })] }), _jsxs("p", { className: "font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums", children: [remoteDriveBackup.header
                                                    ? `${remoteDriveBackup.header.keyCount} ${remoteDriveBackup.header.keyCount === 1 ? 'key' : 'keys'} · `
                                                    : '', formatBytes(remoteDriveBackup.sizeBytes), " \u00B7 Updated", ' ', formatDateTimeShort(remoteDriveBackup.header?.createdAt ?? remoteDriveBackup.modifiedTime)] }), remoteDriveBackup.header?.backupHint && (_jsxs("p", { className: "text-[11px] text-slate-500 dark:text-slate-400", children: ["Backup hint: ", remoteDriveBackup.header.backupHint] }))] })) : !isDriveSessionLive ? (_jsxs("p", { className: "font-mono text-[11px] text-slate-500 dark:text-slate-400", children: [providerLabel, " ready on demand \u00B7 Click refresh or restore below to inspect appDataFolder"] })) : (_jsxs("p", { className: "font-mono text-[11px] text-slate-500 dark:text-slate-400", children: [providerLabel, " connected \u00B7 No keyring backup saved in appDataFolder yet"] })) }), _jsxs("div", { role: "tablist", "aria-label": "Keyring backup or restore mode", className: "mt-4 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-[#0D1018]", children: [_jsx("button", { type: "button", role: "tab", "aria-selected": cloudTab === 'BACKUP', onClick: () => {
                                            setCloudTab('BACKUP');
                                            setCloudFeedback(null);
                                        }, className: `min-h-[40px] rounded-md px-3 py-1 text-xs font-medium transition-colors sm:min-h-[34px] whitespace-nowrap ${cloudTab === 'BACKUP'
                                            ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'}`, children: "Backup Keyring" }), _jsx("button", { type: "button", role: "tab", "aria-selected": cloudTab === 'RESTORE', onClick: () => {
                                            setCloudTab('RESTORE');
                                            setCloudFeedback(null);
                                        }, className: `min-h-[40px] rounded-md px-3 py-1 text-xs font-medium transition-colors sm:min-h-[34px] whitespace-nowrap ${cloudTab === 'RESTORE'
                                            ? 'bg-white font-semibold text-slate-900 shadow-xs dark:bg-[#1A2130] dark:text-[#E5A93C]'
                                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-[#E8ECF4]'}`, children: "Restore Keyring" })] }), cloudFeedback && (_jsx("div", { role: cloudFeedback.tone === 'error' ? 'alert' : 'status', className: `mt-3 rounded-lg border px-3 py-2 text-xs ${cloudFeedback.tone === 'error'
                                    ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'}`, children: cloudFeedback.text })), _jsx("input", { ref: portableFileInputRef, type: "file", accept: ".json,application/json", onChange: (e) => void handlePortableFileChange(e), className: "hidden" }), cloudTab === 'BACKUP' ? (_jsxs("form", { onSubmit: handleRequestDriveBackup, className: "mt-4 space-y-3", children: [_jsxs("div", { children: [_jsxs("label", { htmlFor: "drive-backup-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: ["Backup Vault Passphrase (min ", MIN_DRM_PASSPHRASE_LENGTH, " chars)"] }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "drive-backup-pass", type: showBackupPass ? 'text' : 'password', autoComplete: "new-password", disabled: isCloudBusy, value: backupPassphrase, onChange: (e) => setBackupPassphrase(e.target.value), placeholder: "Passphrase to seal outer backup...", className: "min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", tabIndex: -1, onClick: () => setShowBackupPass((s) => !s), "aria-label": showBackupPass ? 'Hide passphrase' : 'Show passphrase', className: "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200", children: showBackupPass ? (_jsx(EyeOff, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "drive-backup-confirm", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm Backup Passphrase" }), _jsx("input", { id: "drive-backup-confirm", type: showBackupPass ? 'text' : 'password', autoComplete: "new-password", disabled: isCloudBusy, value: backupConfirmPassphrase, onChange: (e) => setBackupConfirmPassphrase(e.target.value), placeholder: "Re-enter backup passphrase...", className: "mt-1 min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "drive-backup-hint", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Optional Backup Hint" }), _jsx("input", { id: "drive-backup-hint", type: "text", maxLength: MAX_DRM_HINT_LENGTH, disabled: isCloudBusy, value: backupHint, onChange: (e) => setBackupHint(e.target.value), placeholder: "Optional reminder for backup passphrase", className: "mt-1 min-h-[36px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { className: "flex flex-col gap-2 pt-1", children: [_jsx("button", { type: "submit", disabled: !isDriveConnected || isCloudBusy || drmKeys.length === 0, className: "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap", children: isCloudBusy ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin", "aria-hidden": "true" }), _jsx("span", { children: "Encrypting & Uploading..." })] })) : (_jsxs(_Fragment, { children: [_jsx(Cloud, { className: "h-4 w-4", "aria-hidden": "true" }), _jsx("span", { children: remoteDriveBackup
                                                                ? `Update ${providerLabel} Backup`
                                                                : `Backup Keyring to ${providerLabel}` })] })) }), _jsxs("button", { type: "button", disabled: isCloudBusy || drmKeys.length === 0, onClick: () => void handleExportPortableBackup(), className: "inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Download, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Download Portable .nkey.json Backup" })] })] })] })) : (_jsxs("form", { onSubmit: handleRequestDriveRestore, className: "mt-4 space-y-3", children: [pendingPortableJson && (_jsxs("div", { className: "flex items-center justify-between gap-2 rounded-lg border border-[#E5A93C]/40 bg-[#E5A93C]/10 px-3 py-2 text-xs text-slate-800 dark:text-[#E8ECF4]", children: [_jsxs("span", { className: "truncate font-mono", children: ["File: ", pendingPortableJson.fileName] }), _jsx("button", { type: "button", onClick: () => setPendingPortableJson(null), "aria-label": "Clear selected portable file", className: "rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10", children: _jsx(X, { className: "h-3.5 w-3.5", "aria-hidden": "true" }) })] })), _jsxs("div", { children: [_jsx("label", { htmlFor: "drive-restore-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Backup Vault Passphrase" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "drive-restore-pass", type: showRestorePass ? 'text' : 'password', autoComplete: "current-password", disabled: isCloudBusy, value: restorePassphrase, onChange: (e) => setRestorePassphrase(e.target.value), placeholder: "Enter backup passphrase to decrypt...", className: "min-h-[38px] w-full rounded-lg border border-slate-300 bg-white pl-3 pr-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#E5A93C] focus:outline-none dark:border-[#242D42] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", tabIndex: -1, onClick: () => setShowRestorePass((s) => !s), "aria-label": showRestorePass ? 'Hide passphrase' : 'Show passphrase', className: "absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200", children: showRestorePass ? (_jsx(EyeOff, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-3.5 w-3.5", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("span", { className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Restore Mode" }), _jsxs("div", { className: "mt-1.5 grid grid-cols-2 gap-2", children: [_jsx("button", { type: "button", onClick: () => setRestoreStrategy('merge'), className: `min-h-[42px] truncate rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:min-h-[36px] sm:px-2.5 whitespace-nowrap ${restoreStrategy === 'merge'
                                                            ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                                                            : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'}`, children: "Merge with Local" }), _jsx("button", { type: "button", onClick: () => setRestoreStrategy('replace'), className: `min-h-[42px] truncate rounded-lg border px-2 py-1.5 text-xs font-semibold transition-colors sm:min-h-[36px] sm:px-2.5 whitespace-nowrap ${restoreStrategy === 'replace'
                                                            ? 'border-[#E5A93C] bg-[#E5A93C]/15 text-slate-900 dark:text-[#E5A93C]'
                                                            : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'}`, children: "Replace Local Keys" })] })] }), _jsxs("div", { className: "flex flex-col gap-2 pt-1", children: [_jsx("button", { type: "submit", disabled: isCloudBusy ||
                                                    (!pendingPortableJson &&
                                                        (!isDriveConnected || (isDriveSessionLive && !remoteDriveBackup))), className: "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap", children: isCloudBusy ? (_jsxs(_Fragment, { children: [_jsx(Loader2, { className: "h-4 w-4 animate-spin", "aria-hidden": "true" }), _jsx("span", { children: "Decrypting & Restoring..." })] })) : pendingPortableJson ? (_jsxs(_Fragment, { children: [_jsx(Upload, { className: "h-4 w-4", "aria-hidden": "true" }), _jsx("span", { children: "Restore from Selected File" })] })) : (_jsxs(_Fragment, { children: [_jsx(Cloud, { className: "h-4 w-4", "aria-hidden": "true" }), _jsxs("span", { children: ["Restore Keyring from ", providerLabel] })] })) }), _jsxs("button", { type: "button", disabled: isCloudBusy, onClick: () => portableFileInputRef.current?.click(), className: "inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Upload, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Select Portable .nkey.json File..." })] })] })] }))] })] }), _jsx(KeyringConfirmDialog, { open: confirmOverwriteDriveOpen, title: `Update Existing ${providerLabel} DRM Keyring Backup?`, description: `This will overwrite your existing ${remoteFileName} backup in ${providerLabel} appDataFolder${remoteDriveBackup?.header
                    ? ` (currently holding ${remoteDriveBackup.header.keyCount} ${remoteDriveBackup.header.keyCount === 1 ? 'key' : 'keys'} from ${formatDateTimeShort(remoteDriveBackup.header.createdAt)})`
                    : ''} with ${drmKeys.length} local ${drmKeys.length === 1 ? 'key' : 'keys'}.`, confirmLabel: "Overwrite Cloud Backup", onCancel: () => setConfirmOverwriteDriveOpen(false), onConfirm: () => {
                    setConfirmOverwriteDriveOpen(false);
                    void executeDriveBackupNow();
                } }), _jsx(KeyringConfirmDialog, { open: confirmDeleteDriveOpen, title: `Delete DRM Keyring Backup from ${providerLabel}?`, description: `This permanently deletes ${remoteFileName} from your ${providerLabel} appDataFolder. Keys currently stored in this browser remain intact.`, confirmLabel: "Delete Cloud Backup", destructive: true, onCancel: () => setConfirmDeleteDriveOpen(false), onConfirm: () => {
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
                            text: err instanceof Error
                                ? err.message
                                : `Failed to delete ${providerLabel} backup.`,
                        });
                    })
                        .finally(() => setIsCloudBusy(false));
                } }), _jsx(KeyringConfirmDialog, { open: confirmReplaceLocalOpen !== null, title: "Replace Local DRM Keyring?", description: `This replaces all ${drmKeys.length} local DRM ${drmKeys.length === 1 ? 'key' : 'keys'} in this browser with the keys from your backup. Any local key not included in the backup will be removed.`, confirmLabel: "Replace Local Keys", destructive: true, onCancel: () => setConfirmReplaceLocalOpen(null), onConfirm: () => {
                    const source = confirmReplaceLocalOpen;
                    setConfirmReplaceLocalOpen(null);
                    if (source === 'file') {
                        void executeRestoreFromFileNow();
                    }
                    else {
                        void executeRestoreFromDriveNow();
                    }
                } }), _jsx(KeyringConfirmDialog, { open: pendingDeleteLocalKey !== null, title: `Delete Managed Key "${pendingDeleteLocalKey?.label ?? ''}"?`, description: pendingDeleteBoundBooks.length > 0
                    ? `${pendingDeleteBoundBooks.length} volume(s) in your library still reference this key (${pendingDeleteLocalKey?.fingerprint}). Rotate those volumes to another key or back up your keyring first—deleting a key without a backup makes bound volumes unrecoverable.`
                    : `Removes "${pendingDeleteLocalKey?.label ?? ''}" (${pendingDeleteLocalKey?.fingerprint ?? ''}) from this browser's keyring.`, details: pendingDeleteBoundBooks.length > 0
                    ? pendingDeleteBoundBooks.map((b) => `${b.title} (${b.format})`)
                    : undefined, confirmLabel: "Delete Key", destructive: true, onCancel: () => setPendingDeleteLocalKey(null), onConfirm: () => {
                    const target = pendingDeleteLocalKey;
                    setPendingDeleteLocalKey(null);
                    if (target) {
                        void onDeleteLocalKey(target.keyId);
                    }
                } })] }));
}
//# sourceMappingURL=DrmKeyVaultPanel.js.map