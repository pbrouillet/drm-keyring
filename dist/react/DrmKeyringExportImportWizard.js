import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Download, Eye, EyeOff, FileKey2, KeyRound, Upload, X, } from 'lucide-react';
import { MIN_DRM_PASSPHRASE_LENGTH } from '../constants.js';
import { parseDrmKeyringBackupJson } from '../keyringCrypto.js';
import { KeyringConfirmDialog } from './KeyringConfirmDialog.js';
export const DrmKeyringExportImportWizard = ({ localKeys, initialMode = 'export', appName = 'Nocturne', onClose, onExportEncryptedBackup, onImportEncryptedBackup, onRedownloadSealedBackup, onOpenDrmKeyVault, }) => {
    const [mode, setMode] = useState(initialMode);
    useEffect(() => {
        setMode(initialMode);
    }, [initialMode]);
    // Export Wizard State (Steps 1 -> 2 -> 3)
    const [exportStep, setExportStep] = useState(1);
    const [exportPassphrase, setExportPassphrase] = useState('');
    const [exportConfirmPassphrase, setExportConfirmPassphrase] = useState('');
    const [exportHint, setExportHint] = useState('');
    const [showExportPassphrase, setShowExportPassphrase] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [exportError, setExportError] = useState(null);
    const [sealedExportReceipt, setSealedExportReceipt] = useState(null);
    // Import Wizard State (Steps 1 -> 2 -> 3)
    const fileInputRef = useRef(null);
    const [importStep, setImportStep] = useState(1);
    const [isDragOver, setIsDragOver] = useState(false);
    const [loadedFileName, setLoadedFileName] = useState('');
    const [loadedRawJson, setLoadedRawJson] = useState('');
    const [parsedPreview, setParsedPreview] = useState(null);
    const [importPassphrase, setImportPassphrase] = useState('');
    const [showImportPassphrase, setShowImportPassphrase] = useState(false);
    const [importStrategy, setImportStrategy] = useState('merge');
    const [isImporting, setIsImporting] = useState(false);
    const [importError, setImportError] = useState(null);
    const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
    const [recoveryReceipt, setRecoveryReceipt] = useState(null);
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
    const handleSealAndDownloadExport = async (e) => {
        e.preventDefault();
        setExportError(null);
        if (localKeys.length === 0) {
            setExportError('Create at least one DRM key before exporting a backup file.');
            return;
        }
        if (!exportPassphrase || exportPassphrase.length < MIN_DRM_PASSPHRASE_LENGTH) {
            setExportError(`Backup passphrase must be at least ${MIN_DRM_PASSPHRASE_LENGTH} characters long.`);
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
        }
        catch (err) {
            setExportError(err instanceof Error ? err.message : 'Failed to seal local keyring backup.');
        }
        finally {
            setIsExporting(false);
        }
    };
    const ingestBackupFile = async (file) => {
        setImportError(null);
        try {
            const text = await file.text();
            const parsed = parseDrmKeyringBackupJson(text);
            setLoadedFileName(file.name);
            setLoadedRawJson(text);
            setParsedPreview(parsed);
            setImportStep(2);
        }
        catch (err) {
            setLoadedFileName('');
            setLoadedRawJson('');
            setParsedPreview(null);
            setImportError(err instanceof Error
                ? err.message
                : `Selected file is not a valid ${appName} .nkey.json keyring backup.`);
        }
    };
    const handleFileInputChange = (e) => {
        const picked = e.target.files?.[0];
        e.target.value = '';
        if (picked) {
            void ingestBackupFile(picked);
        }
    };
    const handleDropFile = (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) {
            void ingestBackupFile(dropped);
        }
    };
    const executeDecryptAndImport = async () => {
        if (!parsedPreview || !loadedRawJson)
            return;
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
        }
        catch (err) {
            setImportError(err instanceof Error ? err.message : 'Incorrect passphrase or corrupted backup file.');
        }
        finally {
            setIsImporting(false);
        }
    };
    const handleSubmitImportForm = (e) => {
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
    const stepLabels = mode === 'export'
        ? ['01. Inspect Keyring', '02. Seal with Passphrase', '03. Download Receipt']
        : ['01. Select Backup File', '02. Decrypt & Strategy', '03. Recovery Complete'];
    return (_jsxs("section", { "aria-labelledby": "keyring-wizard-heading", className: onClose
            ? 'space-y-5'
            : 'space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 dark:border-[#1E2536] dark:bg-[#121620]', children: [_jsxs("div", { className: "flex flex-col gap-3.5 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between dark:border-[#1E2536]", children: [_jsxs("div", { className: "flex min-w-0 items-start gap-2.5", children: [_jsx(FileKey2, { className: "mt-0.5 h-5 w-5 shrink-0 text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("div", { className: "min-w-0", children: [_jsx("h2", { id: "keyring-wizard-heading", className: "font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]", children: "DRM Keyring Backup & Recovery" }), _jsxs("p", { className: "mt-0.5 text-xs text-slate-600 dark:text-slate-400", children: ["Export an ", _jsx("span", { className: "font-mono", children: "AES-256-GCM" }), " encrypted", ' ', _jsx("span", { className: "font-mono", children: ".nkey.json" }), " bundle to physical storage or recover it on another device."] })] })] }), _jsxs("div", { className: "flex items-center justify-between gap-2 sm:justify-end shrink-0", children: [_jsxs("div", { role: "tablist", "aria-label": "Keyring backup wizard mode", className: "grid flex-1 grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 sm:flex-initial dark:border-[#252E42] dark:bg-[#0E121B]", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": mode === 'export', onClick: () => {
                                            setMode('export');
                                            setExportError(null);
                                        }, className: `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap ${mode === 'export'
                                            ? 'bg-[#E5A93C] text-[#0B0D13]'
                                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`, children: [_jsx(Download, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Export" })] }), _jsxs("button", { type: "button", role: "tab", "aria-selected": mode === 'import', onClick: () => {
                                            setMode('import');
                                            setImportError(null);
                                        }, className: `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-[34px] whitespace-nowrap ${mode === 'import'
                                            ? 'bg-[#E5A93C] text-[#0B0D13]'
                                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`, children: [_jsx(Upload, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Import" })] })] }), onClose && (_jsx("button", { type: "button", onClick: onClose, disabled: isExporting || isImporting, "aria-label": "Close keyring backup wizard", className: "flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 sm:min-h-[36px] sm:min-w-[36px] dark:text-slate-400 dark:hover:bg-[#1B2232]", children: _jsx(X, { className: "h-4 w-4", "aria-hidden": "true" }) }))] })] }), _jsx("ol", { "aria-label": "Wizard steps", className: "grid grid-cols-1 gap-2 border-b border-slate-100 pb-3.5 sm:grid-cols-3 dark:border-[#1B2130]", children: stepLabels.map((label, idx) => {
                    const stepNum = (idx + 1);
                    const isCurrent = activeStep === stepNum;
                    const isComplete = activeStep > stepNum;
                    return (_jsxs("li", { className: `flex items-center justify-between border-b-2 pb-1.5 font-mono text-xs tabular-nums ${isCurrent
                            ? 'border-b-[#E5A93C] font-semibold text-slate-900 dark:text-[#E8ECF4]'
                            : isComplete
                                ? 'border-b-emerald-500 text-emerald-700 dark:text-emerald-400'
                                : 'border-b-transparent text-slate-400 dark:text-slate-500'}`, children: [_jsx("span", { children: label }), isComplete && (_jsx(CheckCircle2, { className: "h-3.5 w-3.5 shrink-0", "aria-hidden": "true" }))] }, label));
                }) }), mode === 'export' && (_jsxs("div", { children: [exportError && (_jsx("p", { className: "mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300", children: exportError })), exportStep === 1 && (_jsx("div", { className: "space-y-4", children: localKeys.length === 0 ? (_jsxs("div", { className: "space-y-3 py-2", children: [_jsx("p", { className: "text-sm font-semibold text-slate-900 dark:text-[#E8ECF4]", children: "No Managed DRM Keys Found on This Device" }), _jsxs("p", { className: "text-xs text-slate-600 dark:text-slate-400", children: ["Create a Managed DRM Key in the Key Vault before exporting a backup, or switch to ", _jsx("strong", { children: "Import" }), " above to restore an existing", ' ', _jsx("span", { className: "font-mono", children: ".nkey.json" }), " file onto this device."] }), _jsxs("div", { className: "flex flex-wrap items-center gap-2 pt-1", children: [onOpenDrmKeyVault && (_jsxs("button", { type: "button", onClick: () => {
                                                onClose?.();
                                                onOpenDrmKeyVault();
                                            }, className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-3.5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] whitespace-nowrap", children: [_jsx(KeyRound, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Open DRM Key Vault" })] })), _jsxs("button", { type: "button", onClick: () => setMode('import'), className: "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Upload, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Switch to Import" })] })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 text-xs", children: [_jsx("span", { className: "font-medium text-slate-700 dark:text-slate-300", children: "Keys included in encrypted backup bundle" }), _jsxs("span", { className: "font-mono text-slate-500 dark:text-slate-400 tabular-nums", children: [activeKeyCount, " active \u00B7 ", retiredKeyCount, " retired \u00B7 ", localKeys.length, " total"] })] }), _jsx("div", { className: "max-h-52 divide-y divide-slate-100 overflow-y-auto border-y border-slate-200 dark:divide-[#1B2130] dark:border-[#1E2536]", children: localKeys.map((k) => (_jsxs("div", { className: "flex flex-col gap-1 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("span", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: k.label }), _jsxs("span", { className: "ml-2 font-mono text-slate-500 dark:text-slate-400 tabular-nums", children: ["v", k.generation, " \u00B7 ", k.status, k.isDefault ? ' · default' : ''] })] }), _jsx("span", { className: "font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums", children: k.fingerprint })] }, k.keyId))) }), _jsx("div", { className: "flex justify-end pt-1", children: _jsxs("button", { type: "button", onClick: () => {
                                            setExportError(null);
                                            setExportStep(2);
                                        }, className: "inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[40px] sm:w-auto whitespace-nowrap", children: [_jsx("span", { children: "Continue to Passphrase Sealing" }), _jsx(ArrowRight, { className: "h-3.5 w-3.5", "aria-hidden": "true" })] }) })] })) })), exportStep === 2 && (_jsxs("form", { onSubmit: handleSealAndDownloadExport, className: "space-y-4", children: [_jsxs("p", { className: "text-xs text-slate-600 dark:text-slate-400", children: ["Choose a strong Backup Passphrase to seal the outer", ' ', _jsx("span", { className: "font-mono", children: ".nkey.json" }), " file via", ' ', _jsx("span", { className: "font-mono", children: "PBKDF2-SHA256" }), " (210,000 iterations) +", ' ', _jsx("span", { className: "font-mono", children: "AES-256-GCM" }), ". You will need this passphrase when importing the file onto a new device."] }), _jsxs("div", { className: "grid grid-cols-1 gap-3 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "wizard-export-passphrase", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Backup Passphrase" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "wizard-export-passphrase", type: showExportPassphrase ? 'text' : 'password', autoComplete: "off", value: exportPassphrase, onChange: (e) => setExportPassphrase(e.target.value), placeholder: `At least ${MIN_DRM_PASSPHRASE_LENGTH} characters`, className: "min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", onClick: () => setShowExportPassphrase((v) => !v), "aria-label": showExportPassphrase ? 'Hide passphrase' : 'Show passphrase', className: "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200", children: showExportPassphrase ? (_jsx(EyeOff, { className: "h-4 w-4", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-4 w-4", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "wizard-export-confirm", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Confirm Backup Passphrase" }), _jsx("input", { id: "wizard-export-confirm", type: showExportPassphrase ? 'text' : 'password', autoComplete: "off", value: exportConfirmPassphrase, onChange: (e) => setExportConfirmPassphrase(e.target.value), placeholder: "Re-enter Backup Passphrase", className: "mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] })] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "wizard-export-hint", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Optional Non-Secret Backup Hint" }), _jsx("input", { id: "wizard-export-hint", type: "text", maxLength: 80, value: exportHint, onChange: (e) => setExportHint(e.target.value), placeholder: "e.g., Printed on physical recovery card in desk safe", className: "mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" })] }), _jsxs("div", { className: "flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]", children: [_jsxs("button", { type: "button", onClick: () => {
                                            setExportError(null);
                                            setExportStep(1);
                                        }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(ArrowLeft, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Back" })] }), _jsxs("button", { type: "submit", disabled: isExporting, className: "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap", children: [_jsx(Download, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: isExporting ? 'Encrypting Keyring...' : 'Seal & Download .nkey.json' })] })] })] })), exportStep === 3 && sealedExportReceipt && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-slate-800 dark:text-slate-200", children: [_jsxs("div", { className: "flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300", children: [_jsx(CheckCircle2, { className: "h-4 w-4 shrink-0", "aria-hidden": "true" }), _jsx("span", { children: "Encrypted Backup Downloaded to Physical Storage" })] }), _jsxs("div", { className: "mt-2 space-y-1 font-mono text-xs text-slate-700 dark:text-slate-300 tabular-nums", children: [_jsxs("div", { children: ["File: ", sealedExportReceipt.fileName] }), _jsxs("div", { children: ["Backup ID: ", sealedExportReceipt.backup.backupId, " \u00B7 Keys:", ' ', sealedExportReceipt.backup.keyCount, " \u00B7 Cipher:", ' ', sealedExportReceipt.backup.cipher] }), _jsxs("div", { children: ["Fingerprints: ", sealedExportReceipt.backup.keyFingerprints.join(', ')] })] })] }), _jsxs("div", { className: "flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [onRedownloadSealedBackup && (_jsxs("button", { type: "button", onClick: () => onRedownloadSealedBackup(sealedExportReceipt.backup, sealedExportReceipt.fileName), className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(Download, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Download Again" })] })), onClose && (_jsx("button", { type: "button", onClick: resetExportWizard, className: "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: "New Export" }))] }), _jsx("button", { type: "button", onClick: () => {
                                            resetExportWizard();
                                            onClose?.();
                                        }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap", children: _jsx("span", { children: onClose ? 'Done' : 'Done / Start New Export' }) })] })] }))] })), mode === 'import' && (_jsxs("div", { children: [importError && (_jsx("p", { className: "mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300", children: importError })), importStep === 1 && (_jsxs("div", { className: "space-y-3", children: [_jsx("input", { ref: fileInputRef, type: "file", accept: ".json,.nkey.json,application/json", onChange: handleFileInputChange, className: "hidden" }), _jsxs("div", { onDragOver: (e) => {
                                    e.preventDefault();
                                    setIsDragOver(true);
                                }, onDragLeave: () => setIsDragOver(false), onDrop: handleDropFile, className: `flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${isDragOver
                                    ? 'border-[#E5A93C] bg-[#E5A93C]/10'
                                    : 'border-slate-300 bg-slate-50/50 dark:border-[#283248] dark:bg-[#0D1018]'}`, children: [_jsx(Upload, { className: "h-6 w-6 text-[#E5A93C]", "aria-hidden": "true" }), _jsxs("p", { className: "mt-2 text-xs font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Drop your encrypted ", _jsx("span", { className: "font-mono", children: ".nkey.json" }), " keyring backup here"] }), _jsxs("p", { className: "mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400", children: [appName, " inspects the authenticated header metadata locally before prompting for your Backup Passphrase."] }), _jsxs("button", { type: "button", onClick: () => fileInputRef.current?.click(), className: "mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap", children: [_jsx(Upload, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Choose .nkey.json File" })] })] })] })), importStep === 2 && parsedPreview && (_jsxs("form", { onSubmit: handleSubmitImportForm, className: "space-y-4", children: [_jsxs("div", { className: "border-b border-slate-200 pb-3.5 text-xs dark:border-[#1E2536]", children: [_jsxs("div", { className: "font-semibold text-slate-900 dark:text-[#E8ECF4]", children: ["Verified Backup Envelope \u00B7 ", _jsx("span", { className: "font-mono", children: loadedFileName })] }), _jsxs("div", { className: "mt-1.5 space-y-1 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums", children: [_jsxs("div", { children: ["Backup ID: ", parsedPreview.backupId, " \u00B7 Created", ' ', new Date(parsedPreview.createdAt).toLocaleString()] }), _jsxs("div", { children: ["Contains ", parsedPreview.keyCount, ' ', parsedPreview.keyCount === 1 ? 'Managed DRM Key' : 'Managed DRM Keys', " \u00B7", ' ', parsedPreview.kdf, " (", parsedPreview.iterations.toLocaleString(), " iter)"] }), _jsxs("div", { children: ["Fingerprints: ", parsedPreview.keyFingerprints.join(', ')] }), parsedPreview.backupHint && (_jsxs("div", { className: "font-sans text-slate-700 dark:text-slate-300", children: ["Backup Hint: ", _jsx("strong", { children: parsedPreview.backupHint })] }))] })] }), _jsxs("div", { className: "grid grid-cols-1 gap-4 sm:grid-cols-2", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "wizard-import-passphrase", className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Backup Passphrase" }), _jsxs("div", { className: "relative mt-1", children: [_jsx("input", { id: "wizard-import-passphrase", type: showImportPassphrase ? 'text' : 'password', autoComplete: "off", value: importPassphrase, onChange: (e) => setImportPassphrase(e.target.value), placeholder: "Enter Backup Passphrase", className: "min-h-[42px] w-full rounded-lg border border-slate-300 bg-white py-2 pr-10 pl-3 text-xs text-slate-900 focus:border-[#E5A93C] focus:outline-none dark:border-[#283248] dark:bg-[#0D1018] dark:text-[#E8ECF4]" }), _jsx("button", { type: "button", onClick: () => setShowImportPassphrase((v) => !v), "aria-label": showImportPassphrase ? 'Hide passphrase' : 'Show passphrase', className: "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200", children: showImportPassphrase ? (_jsx(EyeOff, { className: "h-4 w-4", "aria-hidden": "true" })) : (_jsx(Eye, { className: "h-4 w-4", "aria-hidden": "true" })) })] })] }), _jsxs("div", { children: [_jsx("span", { className: "block text-xs font-medium text-slate-700 dark:text-slate-300", children: "Keyring Recovery Strategy" }), _jsxs("div", { className: "mt-1 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2", children: [_jsx("button", { type: "button", onClick: () => setImportStrategy('merge'), className: `min-h-[42px] rounded-lg border px-3 py-1.5 text-center text-xs transition-colors whitespace-nowrap ${importStrategy === 'merge'
                                                            ? 'border-[#E5A93C] bg-[#E5A93C]/15 font-semibold text-slate-900 dark:text-[#E5A93C]'
                                                            : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'}`, children: "Merge Keys" }), _jsx("button", { type: "button", onClick: () => setImportStrategy('replace'), className: `min-h-[42px] rounded-lg border px-3 py-1.5 text-center text-xs transition-colors whitespace-nowrap ${importStrategy === 'replace'
                                                            ? 'border-red-500/60 bg-red-500/10 font-semibold text-red-700 dark:text-red-300'
                                                            : 'border-slate-200 text-slate-600 dark:border-[#252E42] dark:text-slate-400'}`, children: "Replace Local" })] })] })] }), _jsxs("div", { className: "flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-[#1B2130]", children: [_jsxs("button", { type: "button", onClick: resetImportWizard, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(ArrowLeft, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: "Choose Different File" })] }), _jsxs("button", { type: "submit", disabled: isImporting, className: "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-[#E5A93C] px-4 py-2 text-xs font-semibold text-[#0B0D13] transition-colors hover:bg-[#eeb954] disabled:opacity-50 sm:min-h-[40px] whitespace-nowrap", children: [_jsx(KeyRound, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), _jsx("span", { children: isImporting ? 'Verifying & Restoring...' : 'Decrypt & Recover Keyring' })] })] })] })), importStep === 3 && recoveryReceipt && (_jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-slate-800 dark:text-slate-200", children: [_jsxs("div", { className: "flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300", children: [_jsx(CheckCircle2, { className: "h-4 w-4 shrink-0", "aria-hidden": "true" }), _jsx("span", { children: "DRM Keyring Recovered to Browser IndexedDB" })] }), _jsxs("p", { className: "mt-1.5 text-xs text-slate-700 dark:text-slate-300", children: ["Verified AES-256-GCM authenticity tag and imported", ' ', _jsx("strong", { children: recoveryReceipt.restoredCount }), ' ', recoveryReceipt.restoredCount === 1 ? 'key' : 'keys', ". Your device now holds", ' ', _jsx("strong", { children: recoveryReceipt.totalKeyCount }), " Managed DRM", ' ', recoveryReceipt.totalKeyCount === 1 ? 'Key' : 'Keys', " ready to unlock encrypted", ' ', _jsx("span", { className: "font-mono", children: ".ndrm" }), " volumes immediately."] }), _jsxs("div", { className: "mt-2 font-mono text-xs text-slate-600 dark:text-slate-400 tabular-nums", children: ["Restored Fingerprints: ", recoveryReceipt.fingerprints.join(', ')] })] }), _jsxs("div", { className: "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 dark:border-[#1B2130]", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [onOpenDrmKeyVault && (_jsxs("button", { type: "button", onClick: () => {
                                                    onClose?.();
                                                    onOpenDrmKeyVault();
                                                }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: [_jsx(KeyRound, { className: "h-3.5 w-3.5 text-[#E5A93C]", "aria-hidden": "true" }), _jsx("span", { children: "Inspect Keys in Vault" })] })), onClose && (_jsx("button", { type: "button", onClick: resetImportWizard, className: "inline-flex min-h-[44px] items-center justify-center rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 sm:min-h-[38px] dark:border-[#283248] dark:text-slate-200 dark:hover:bg-[#1B2232] whitespace-nowrap", children: "Import Another File" }))] }), _jsx("button", { type: "button", onClick: () => {
                                            resetImportWizard();
                                            onClose?.();
                                        }, className: "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#E5A93C] px-5 py-1.5 text-xs font-semibold text-[#0B0D13] hover:bg-[#eeb954] sm:min-h-[38px] whitespace-nowrap", children: _jsx("span", { children: onClose ? 'Done' : 'Done / Import Another File' }) })] })] })), _jsx(KeyringConfirmDialog, { open: confirmReplaceOpen, title: "Replace Existing Local DRM Keys?", description: `This device currently stores ${localKeys.length} Managed DRM ${localKeys.length === 1 ? 'Key' : 'Keys'}. Replacing your local keyring will remove any local keys not present in this backup file. Choose "Merge Keys" instead unless you intend to overwrite them.`, confirmLabel: "Replace Local Keyring", onCancel: () => setConfirmReplaceOpen(false), onConfirm: () => {
                            setConfirmReplaceOpen(false);
                            void executeDecryptAndImport();
                        } })] }))] }));
};
//# sourceMappingURL=DrmKeyringExportImportWizard.js.map