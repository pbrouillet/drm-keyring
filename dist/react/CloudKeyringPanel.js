import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Cloud, Download, Eye, EyeOff, Info, KeyRound, Lock, RefreshCw, Shield, Trash2, Unlock, Upload, X, } from 'lucide-react';
import { DEFAULT_KEYRING_FILENAME, MIN_DRM_PASSPHRASE_LENGTH, } from '../constants.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';
export const CloudKeyringPanel = ({ isDriveConnected, isDriveSessionLive = isDriveConnected, isOptedIn, isSessionUnlocked, isSyncingKeyring, isInspectingRemote, cloudKeyringError, lastKeyringSyncedAt, localKeys, remoteSummary, cloudKeyringHint, providerLabel = 'Google Drive', remoteFileName = DEFAULT_KEYRING_FILENAME, renderConnectButton, onConnectDrive, onRefreshRemoteStatus, onEnableAndUnlock, onSyncKeyringNow, onRotateMasterPassphrase, onLockSession, onDisableCloudKeyring, onOpenDrmKeyVault, onOpenExportWizard, onOpenImportWizard, }) => {
    const [specDialogOpen, setSpecDialogOpen] = useState(false);
    const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
    const [setupExpanded, setSetupExpanded] = useState(false);
    const [resetRemoteMode, setResetRemoteMode] = useState(false);
    const [masterPassphrase, setMasterPassphrase] = useState('');
    const [confirmPassphrase, setConfirmPassphrase] = useState('');
    const [hintInput, setHintInput] = useState(cloudKeyringHint ?? '');
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [formError, setFormError] = useState(null);
    const [statusNotice, setStatusNotice] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
    const [confirmDisableDeleteOpen, setConfirmDisableDeleteOpen] = useState(false);
    useEffect(() => {
        if (!specDialogOpen && !rotateDialogOpen)
            return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !isSubmitting) {
                setSpecDialogOpen(false);
                setRotateDialogOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [specDialogOpen, rotateDialogOpen, isSubmitting]);
    const effectiveHint = remoteSummary?.header?.backupHint || cloudKeyringHint || undefined;
    const requiresNewPassphraseConfirmation = !remoteSummary || resetRemoteMode || rotateDialogOpen;
    const clearPassphraseInputs = () => {
        setMasterPassphrase('');
        setConfirmPassphrase('');
        setShowPassphrase(false);
    };
    const connectButtonNode = renderConnectButton ? (renderConnectButton()) : (_jsxs("button", { type: "button", onClick: onConnectDrive, className: "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-[#283248] dark:bg-[#121620] dark:text-slate-100 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0", children: [_jsx(Cloud, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("span", { children: ["Connect ", providerLabel] })] }));
    const executeEnableOrUnlock = async (forceOverwrite) => {
        setFormError(null);
        setStatusNotice(null);
        if (!masterPassphrase) {
            setFormError('Enter your Cloud Keyring Master Passphrase.');
            return;
        }
        if ((!remoteSummary || forceOverwrite) && masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
            setFormError(`Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
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
            setStatusNotice(result.pushed
                ? `Cloud Keyring session unlocked (${result.mergedCount} ${result.mergedCount === 1 ? 'key' : 'keys'} synchronized via E2EE).`
                : 'Cloud Keyring session armed. Create a DRM key in the Vault to push your first encrypted keyring.');
        }
        catch (err) {
            setFormError(err instanceof Error ? err.message : 'Unable to unlock Cloud Keyring session.');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const handleSubmitUnlockForm = (e) => {
        e.preventDefault();
        if (remoteSummary && resetRemoteMode) {
            if (!masterPassphrase || masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
                setFormError(`New Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
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
    const handleSubmitRotatePassphrase = async (e) => {
        e.preventDefault();
        setFormError(null);
        setStatusNotice(null);
        if (!masterPassphrase || masterPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
            setFormError(`New Master Passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
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
            setStatusNotice('Rotated Cloud Keyring Master Passphrase with a fresh 128-bit PBKDF2 salt and re-sealed appDataFolder.');
        }
        catch (err) {
            setFormError(err instanceof Error ? err.message : 'Failed to rotate Cloud Keyring Master Passphrase.');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const handleManualSync = async () => {
        setFormError(null);
        setStatusNotice(null);
        try {
            const res = await onSyncKeyringNow();
            setStatusNotice(res.pushed
                ? `Synchronized ${res.mergedCount} ${res.mergedCount === 1 ? 'managed key' : 'managed keys'} with ${providerLabel} appDataFolder.`
                : 'Cloud Keyring checked — no keys to push yet.');
        }
        catch (err) {
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
    return (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4 lg:flex-row lg:items-center lg:justify-between dark:border-[#1E2536] dark:bg-[#121620]", children: [_jsxs("div", { className: "flex min-w-0 items-center gap-2.5", children: [isOptedIn && isSessionUnlocked ? (_jsx(Unlock, { className: "h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400", "aria-hidden": "true" })) : (_jsx(Lock, { className: "h-4 w-4 shrink-0 text-[#E5A93C]", "aria-hidden": "true" })), _jsxs("div", { className: "min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs tabular-nums", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: statusHeadline }), _jsx("span", { className: "text-slate-400 dark:text-slate-600", "aria-hidden": "true", children: "\u00B7" }), _jsxs("span", { className: "text-slate-500 dark:text-slate-400", children: [localKeys.length, " local ", localKeys.length === 1 ? 'key' : 'keys'] }), lastKeyringSyncedAt > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { className: "text-slate-400 dark:text-slate-600", "aria-hidden": "true", children: "\u00B7" }), _jsxs("span", { className: "text-slate-500 dark:text-slate-400", children: ["Synced", ' ', new Date(lastKeyringSyncedAt).toLocaleTimeString([], {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })] })] }))] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 shrink-0", children: [onOpenExportWizard && (_jsxs("button", { type: "button", onClick: onOpenExportWizard, className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Download, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: "Export .nkey" })] })), onOpenImportWizard && (_jsxs("button", { type: "button", onClick: onOpenImportWizard, className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Upload, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: "Import / Recover" })] })), _jsxs("button", { type: "button", onClick: () => setSpecDialogOpen(true), className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[36px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Info, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "E2EE Spec" })] }), onOpenDrmKeyVault && (_jsxs("button", { type: "button", onClick: onOpenDrmKeyVault, className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[36px] whitespace-nowrap", children: [_jsx(KeyRound, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Open Key Vault" })] }))] })] }), _jsxs("section", { "aria-labelledby": "cloud-keyring-heading", className: "space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]", children: [_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", children: [_jsxs("div", { className: "flex min-w-0 items-start gap-2.5", children: [_jsx(Shield, { className: "mt-0.5 h-5 w-5 shrink-0 text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("div", { className: "min-w-0", children: [_jsxs("h2", { id: "cloud-keyring-heading", className: "font-display text-base font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Zero-Knowledge ", providerLabel, " Keyring Sync"] }), _jsx("p", { className: "mt-0.5 text-xs text-slate-600 dark:text-slate-400", children: "Synchronize your Managed DRM Keyring across devices using an end-to-end encrypted vault. Your Master Passphrase is never stored locally or in the cloud." })] })] }), isDriveConnected ? (_jsxs("button", { type: "button", disabled: isInspectingRemote || isSyncingKeyring, onClick: () => void onRefreshRemoteStatus(), className: "inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:w-auto dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap shrink-0", children: [_jsx(RefreshCw, { className: `h-3.5 w-3.5 ${isInspectingRemote ? 'animate-spin' : ''}`, "aria-hidden": "true" }), _jsx("span", { children: isInspectingRemote ? 'Checking...' : 'Check Drive' })] })) : (_jsx("div", { className: "shrink-0", children: connectButtonNode }))] }), _jsxs("div", { className: "border-y border-slate-100 py-3.5 text-xs dark:border-[#1B2130]", children: [_jsxs("div", { className: "font-medium text-slate-700 dark:text-slate-300", children: ["Remote ", _jsx("span", { className: "font-mono", children: "appDataFolder" }), " Bundle"] }), !isDriveConnected ? (_jsxs("p", { className: "mt-1 text-slate-500 dark:text-slate-400", children: ["Connect ", providerLabel, " to inspect or synchronize your encrypted Cloud Keyring."] })) : remoteSummary ? (_jsxs("p", { className: "mt-1 font-mono text-slate-600 dark:text-slate-400 tabular-nums", children: [remoteSummary.header?.keyCount ?? 0, ' ', (remoteSummary.header?.keyCount ?? 0) === 1 ? 'encrypted key' : 'encrypted keys', " \u00B7 Updated ", new Date(remoteSummary.modifiedTime).toLocaleString(), " \u00B7", ' ', Math.max(1, Math.round(remoteSummary.sizeBytes / 1024)), " KB", remoteSummary.header?.keyFingerprints?.length
                                        ? ` · ${remoteSummary.header.keyFingerprints.slice(0, 2).join(', ')}${remoteSummary.header.keyFingerprints.length > 2
                                            ? ` +${remoteSummary.header.keyFingerprints.length - 2}`
                                            : ''}`
                                        : ''] })) : !isDriveSessionLive ? (_jsxs("p", { className: "mt-1 font-mono text-slate-500 dark:text-slate-400", children: [providerLabel, " ready on demand \u00B7 Click Check Drive or unlock below to inspect appDataFolder."] })) : (_jsxs("p", { className: "mt-1 font-mono text-slate-500 dark:text-slate-400", children: ["No encrypted Cloud Keyring bundle stored in ", providerLabel, " yet."] })), effectiveHint && (_jsxs("p", { className: "mt-1 text-slate-500 dark:text-slate-400", children: ["Passphrase hint: ", _jsx("span", { className: "font-medium text-slate-700 dark:text-slate-300", children: effectiveHint })] }))] }), (cloudKeyringError || formError) && !rotateDialogOpen && (_jsx("p", { className: "rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300", children: formError || cloudKeyringError })), statusNotice && (_jsx("p", { className: "rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-300", children: statusNotice })), !isOptedIn && !setupExpanded && (_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsx("p", { className: "text-xs text-slate-600 dark:text-slate-400", children: "DRM keys currently remain solely inside this browser's IndexedDB. Opt in to keep keys synchronized across devices using your Master Passphrase." }), _jsxs("button", { type: "button", onClick: () => {
                                    setFormError(null);
                                    setStatusNotice(null);
                                    setSetupExpanded(true);
                                }, className: "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[40px] sm:w-auto whitespace-nowrap shrink-0", children: [_jsx(Unlock, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Enable Cloud Keyring" })] })] })), ((!isOptedIn && setupExpanded) || (isOptedIn && !isSessionUnlocked)) && (_jsx("div", { className: "space-y-4 pt-1", children: !isDriveConnected ? (_jsxs("div", { className: "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "space-y-1", children: [_jsxs("p", { className: "text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Connect ", providerLabel, " to Unlock Cloud Keyring"] }), _jsxs("p", { className: "text-xs text-slate-600 dark:text-slate-400", children: ["Cloud Keyring reads and writes the encrypted bundle inside your private", ' ', providerLabel, " ", _jsx("span", { className: "font-mono", children: "appDataFolder" }), "."] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 shrink-0", children: [connectButtonNode, !isOptedIn && (_jsx("button", { type: "button", onClick: () => setSetupExpanded(false), className: "min-h-[40px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232]", children: "Cancel" }))] })] })) : (_jsxs("form", { onSubmit: handleSubmitUnlockForm, className: "space-y-3.5", children: [_jsxs("div", { className: "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between", children: [_jsx("div", { className: "text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]", children: remoteSummary && !resetRemoteMode
                                                ? 'Enter Master Passphrase to Unlock & Merge Cloud Keyring'
                                                : remoteSummary && resetRemoteMode
                                                    ? 'Create New Master Passphrase (Overwrites Remote Cloud Keyring)'
                                                    : 'Set Master Passphrase to Initialize Cloud Keyring' }), remoteSummary && (_jsx("button", { type: "button", onClick: () => {
                                                setResetRemoteMode((v) => !v);
                                                setFormError(null);
                                                clearPassphraseInputs();
                                            }, className: "self-start text-xs font-medium text-[#C5841A] underline-offset-2 hover:underline sm:self-auto dark:text-[#E5A93C]", children: resetRemoteMode
                                                ? 'Unlock existing remote keyring instead'
                                                : 'Forgot passphrase? Reset remote keyring' }))] }), _jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "cloud-keyring-master-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Master Passphrase (never stored)" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "cloud-keyring-master-pass", type: showPassphrase ? 'text' : 'password', autoComplete: "off", value: masterPassphrase, onChange: (e) => setMasterPassphrase(e.target.value), placeholder: remoteSummary && !resetRemoteMode
                                                                ? 'Enter existing Master Passphrase'
                                                                : `At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`, className: "min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", onClick: () => setShowPassphrase((v) => !v), "aria-label": showPassphrase ? 'Hide passphrase' : 'Show passphrase', className: "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200", children: showPassphrase ? (_jsx(EyeOff, { className: "h-4 w-4", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-4 w-4", "aria-hidden": "true" })) })] })] }), requiresNewPassphraseConfirmation ? (_jsxs("div", { children: [_jsx("label", { htmlFor: "cloud-keyring-confirm-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm Master Passphrase" }), _jsx("input", { id: "cloud-keyring-confirm-pass", type: showPassphrase ? 'text' : 'password', autoComplete: "off", value: confirmPassphrase, onChange: (e) => setConfirmPassphrase(e.target.value), placeholder: "Re-enter Master Passphrase", className: "mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] })) : (_jsx("div", { className: "flex flex-col justify-end", children: _jsx("p", { className: "text-xs text-slate-500 dark:text-slate-400", children: "Derives a non-extractable session key in RAM, decrypts & merges remote keys, and auto-syncs keyring changes until you lock or close the app." }) }))] }), requiresNewPassphraseConfirmation && (_jsxs("div", { children: [_jsx("label", { htmlFor: "cloud-keyring-hint", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Optional Non-Secret Memory Hint" }), _jsx("input", { id: "cloud-keyring-hint", type: "text", maxLength: 80, value: hintInput, onChange: (e) => setHintInput(e.target.value), placeholder: "e.g., Studio brass notebook phrase (never write your passphrase)", className: "mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] })), _jsxs("div", { className: "flex flex-col gap-2 border-t border-slate-100 pt-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-[#1B2130]", children: [_jsxs("div", { className: "flex flex-col gap-2 min-[420px]:flex-row min-[420px]:items-center", children: [_jsxs("button", { type: "submit", disabled: isSubmitting || isSyncingKeyring, className: "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap", children: [_jsx(Unlock, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: isSubmitting
                                                                ? 'Deriving Key & Syncing...'
                                                                : remoteSummary && !resetRemoteMode
                                                                    ? 'Unlock Session & Merge Keys'
                                                                    : resetRemoteMode
                                                                        ? 'Overwrite & Seal New Keyring'
                                                                        : 'Initialize & Unlock Keyring' })] }), !isOptedIn && (_jsx("button", { type: "button", onClick: () => {
                                                        setSetupExpanded(false);
                                                        setResetRemoteMode(false);
                                                        setFormError(null);
                                                        clearPassphraseInputs();
                                                    }, className: "min-h-[44px] rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232]", children: "Cancel" }))] }), isOptedIn && (_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => void onDisableCloudKeyring(false), className: "min-h-[44px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap", children: "Opt Out on Device" }), remoteSummary && (_jsxs("button", { type: "button", onClick: () => setConfirmDisableDeleteOpen(true), className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 sm:min-h-[38px] dark:text-red-400 whitespace-nowrap", children: [_jsx(Trash2, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Delete Cloud File" })] }))] }))] })] })) })), isOptedIn && isSessionUnlocked && (_jsxs("div", { className: "flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between", children: [_jsxs("div", { className: "flex flex-col gap-2 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:items-center", children: [_jsxs("button", { type: "button", disabled: isSyncingKeyring || !isDriveConnected, onClick: () => void handleManualSync(), className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap", children: [_jsx(RefreshCw, { className: `h-3.5 w-3.5 ${isSyncingKeyring ? 'animate-spin' : ''}`, "aria-hidden": "true" }), _jsx("span", { children: isSyncingKeyring ? 'Syncing Keyring...' : 'Sync Keyring Now' })] }), _jsxs("button", { type: "button", onClick: () => {
                                            setFormError(null);
                                            clearPassphraseInputs();
                                            setRotateDialogOpen(true);
                                        }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(KeyRound, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: "Rotate Passphrase" })] }), _jsxs("button", { type: "button", onClick: () => {
                                            onLockSession();
                                            setRotateDialogOpen(false);
                                            setStatusNotice('Locked Cloud Keyring session and cleared volatile CryptoKey.');
                                        }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Lock, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Lock Session" })] })] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx("button", { type: "button", onClick: () => void onDisableCloudKeyring(false), className: "min-h-[44px] rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-300 dark:hover:bg-[#1B2232] whitespace-nowrap", children: "Opt Out" }), remoteSummary && (_jsxs("button", { type: "button", onClick: () => setConfirmDisableDeleteOpen(true), className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/10 sm:min-h-[38px] dark:text-red-400 whitespace-nowrap", children: [_jsx(Trash2, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Delete Cloud Keyring" })] }))] })] }))] }), specDialogOpen && (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "e2ee-spec-dialog-title", className: "fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4", onClick: () => setSpecDialogOpen(false), children: _jsxs("div", { className: "max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-xl sm:p-6 dark:border-[#242C3F] dark:bg-[#121620]", onClick: (e) => e.stopPropagation(), children: [_jsx("div", { className: "mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700", "aria-hidden": "true" }), _jsxs("div", { className: "flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5 dark:border-[#1E2536]", children: [_jsxs("div", { children: [_jsx("h2", { id: "e2ee-spec-dialog-title", className: "font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]", children: "Zero-Knowledge Cloud Keyring Architecture" }), _jsx("p", { className: "mt-0.5 text-xs text-slate-500 dark:text-slate-400", children: "End-to-end encryption protocol for cross-device DRM key portability" })] }), _jsx("button", { type: "button", onClick: () => setSpecDialogOpen(false), "aria-label": "Close E2EE specification", className: "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]", children: _jsx(X, { className: "h-4 w-4", "aria-hidden": "true" }) })] }), _jsxs("div", { className: "mt-4 divide-y divide-slate-100 text-xs text-slate-700 dark:divide-[#1B2130] dark:text-slate-300", children: [_jsxs("div", { className: "py-3", children: [_jsx("div", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "01. Zero-Stored-Passphrase KDF" }), _jsxs("p", { className: "mt-1 leading-relaxed text-slate-600 dark:text-slate-400", children: ["Your Master Passphrase derives a 256-bit AES-GCM Web Crypto key via", ' ', _jsx("span", { className: "font-mono", children: "PBKDF2-SHA256" }), " (210,000 iterations, 128-bit CSPRNG salt) with ", _jsx("span", { className: "font-mono", children: "extractable: false" }), ", then immediately zeroes passphrase bytes in RAM."] })] }), _jsxs("div", { className: "py-3", children: [_jsx("div", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "02. Double-Layer Envelope Sealing" }), _jsxs("p", { className: "mt-1 leading-relaxed text-slate-600 dark:text-slate-400", children: ["Individual Managed Keys remain wrapped under their own KEKs inside an outer", ' ', _jsx("span", { className: "font-mono", children: "AES-256-GCM" }), " vault with a fresh 96-bit random IV and canonical header AAD on every push."] })] }), _jsxs("div", { className: "py-3", children: [_jsx("div", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "03. Isolated Drive Storage" }), _jsxs("p", { className: "mt-1 leading-relaxed text-slate-600 dark:text-slate-400", children: ["Stored exclusively in your private ", providerLabel, ' ', _jsx("span", { className: "font-mono", children: "appDataFolder" }), " (", _jsx("span", { className: "font-mono", children: remoteFileName }), "). Zero DRM keys or fingerprints are ever written to Cloud Firestore."] })] }), _jsxs("div", { className: "py-3", children: [_jsx("div", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "04. Deterministic Conflict Merge" }), _jsxs("p", { className: "mt-1 leading-relaxed text-slate-600 dark:text-slate-400", children: ["Unlocking on a second device verifies the GCM authentication tag + AAD and merges keys by ", _jsx("span", { className: "font-mono", children: "keyId" }), " and", ' ', _jsx("span", { className: "font-mono", children: "updatedAt" }), " without losing retired rotation history."] })] })] }), _jsx("div", { className: "mt-4 flex justify-end border-t border-slate-200 pt-4 dark:border-[#1E2536]", children: _jsx("button", { type: "button", onClick: () => setSpecDialogOpen(false), className: "min-h-[40px] w-full rounded-lg bg-[#E5A93C] px-5 py-2 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[36px] sm:w-auto", children: "Done" }) })] }) })), rotateDialogOpen && (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "rotate-passphrase-dialog-title", className: "fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4", onClick: () => {
                    if (!isSubmitting)
                        setRotateDialogOpen(false);
                }, children: _jsxs("div", { className: "max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-xl sm:p-6 dark:border-[#242C3F] dark:bg-[#121620]", onClick: (e) => e.stopPropagation(), children: [_jsx("div", { className: "mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700", "aria-hidden": "true" }), _jsxs("div", { className: "flex items-start justify-between gap-3 border-b border-slate-200 pb-3.5 dark:border-[#1E2536]", children: [_jsxs("div", { children: [_jsx("h2", { id: "rotate-passphrase-dialog-title", className: "font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]", children: "Rotate Cloud Keyring Master Passphrase" }), _jsxs("p", { className: "mt-0.5 text-xs text-slate-500 dark:text-slate-400", children: ["Generates a fresh 128-bit PBKDF2 salt and re-seals your remote ", providerLabel, ' ', "bundle"] })] }), _jsx("button", { type: "button", disabled: isSubmitting, onClick: () => setRotateDialogOpen(false), "aria-label": "Close passphrase rotation dialog", className: "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]", children: _jsx(X, { className: "h-4 w-4", "aria-hidden": "true" }) })] }), _jsxs("form", { onSubmit: handleSubmitRotatePassphrase, className: "mt-4 space-y-4", children: [formError && (_jsx("p", { className: "rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300", children: formError })), _jsxs("div", { children: [_jsx("label", { htmlFor: "rotate-cloud-master-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "New Master Passphrase" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "rotate-cloud-master-pass", type: showPassphrase ? 'text' : 'password', autoComplete: "off", value: masterPassphrase, onChange: (e) => setMasterPassphrase(e.target.value), placeholder: `At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`, className: "min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", onClick: () => setShowPassphrase((v) => !v), "aria-label": showPassphrase ? 'Hide passphrase' : 'Show passphrase', className: "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200", children: showPassphrase ? (_jsx(EyeOff, { className: "h-4 w-4", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-4 w-4", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "rotate-cloud-confirm-pass", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm New Master Passphrase" }), _jsx("input", { id: "rotate-cloud-confirm-pass", type: showPassphrase ? 'text' : 'password', autoComplete: "off", value: confirmPassphrase, onChange: (e) => setConfirmPassphrase(e.target.value), placeholder: "Re-enter new Master Passphrase", className: "mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "rotate-cloud-hint", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Updated Optional Hint" }), _jsx("input", { id: "rotate-cloud-hint", type: "text", maxLength: 80, value: hintInput, onChange: (e) => setHintInput(e.target.value), placeholder: "Optional non-secret reminder", className: "mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { className: "flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end dark:border-[#1E2536]", children: [_jsx("button", { type: "button", disabled: isSubmitting, onClick: () => setRotateDialogOpen(false), className: "min-h-[42px] rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232]", children: "Cancel" }), _jsx("button", { type: "submit", disabled: isSubmitting || isSyncingKeyring, className: "inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-4 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[38px] whitespace-nowrap", children: isSubmitting ? 'Re-Sealing...' : 'Save & Re-Seal Keyring' })] })] })] }) })), _jsx(KeyringConfirmDialog, { open: confirmOverwriteOpen, title: `Overwrite Existing ${providerLabel} Cloud Keyring?`, description: `An encrypted Cloud Keyring bundle already exists in your ${providerLabel} appDataFolder. Continuing will replace that remote bundle with this device's current local keys sealed under your new Master Passphrase.`, confirmLabel: "Overwrite Cloud Keyring", onCancel: () => setConfirmOverwriteOpen(false), onConfirm: () => {
                    setConfirmOverwriteOpen(false);
                    void executeEnableOrUnlock(true);
                } }), _jsx(KeyringConfirmDialog, { open: confirmDisableDeleteOpen, title: `Delete Encrypted Cloud Keyring from ${providerLabel}?`, description: `This turns off Cloud Keyring sync and permanently removes ${remoteFileName} from your ${providerLabel} appDataFolder. Keys already stored in this browser's IndexedDB will remain intact.`, confirmLabel: "Delete Remote Cloud Keyring", onCancel: () => setConfirmDisableDeleteOpen(false), onConfirm: () => {
                    setConfirmDisableDeleteOpen(false);
                    void onDisableCloudKeyring(true);
                } })] }));
};
//# sourceMappingURL=CloudKeyringPanel.js.map