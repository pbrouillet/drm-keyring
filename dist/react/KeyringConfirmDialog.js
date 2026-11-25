import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
export const KeyringConfirmDialog = ({ open, title, description, details, confirmLabel, destructive = true, onConfirm, onCancel, }) => {
    useEffect(() => {
        if (!open)
            return;
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
            }
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [onCancel, open]);
    if (!open)
        return null;
    return (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "keyring-confirm-dialog-title", className: "fixed inset-0 z-[65] flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4", onClick: onCancel, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), className: "max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:max-h-[90vh] sm:rounded-xl sm:border sm:p-6 dark:border-[#252D40] dark:bg-[#121620]", children: [_jsx("div", { "aria-hidden": "true", className: "mx-auto mb-3.5 h-1.5 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700" }), _jsxs("div", { className: "flex items-start gap-3", children: [_jsx("div", { className: "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-[#E5A93C]", children: _jsx(AlertTriangle, { className: "h-5 w-5", "aria-hidden": "true" }) }), _jsxs("div", { className: "min-w-0 flex-1", children: [_jsx("h3", { id: "keyring-confirm-dialog-title", className: "font-display text-base font-semibold text-slate-900 sm:text-lg dark:text-[#E8ECF4]", children: title }), _jsx("p", { className: "mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300", children: description }), details && details.length > 0 && (_jsx("ul", { className: "mt-3 max-h-36 space-y-1 overflow-y-auto border-t border-slate-200 pt-2.5 text-xs text-slate-600 dark:border-[#22293A] dark:text-slate-400", children: details.map((line, idx) => (_jsx("li", { className: "truncate font-mono tabular-nums", children: line }, idx))) }))] })] }), _jsxs("div", { className: "mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3", children: [_jsx("button", { type: "button", onClick: onCancel, className: "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 sm:min-h-[40px] sm:w-auto dark:border-[#283146] dark:text-slate-300 dark:hover:bg-[#1A2030] whitespace-nowrap", children: "Cancel" }), _jsx("button", { type: "button", onClick: onConfirm, className: `inline-flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 py-2 text-xs font-semibold transition-colors sm:min-h-[40px] sm:w-auto whitespace-nowrap ${destructive
                                ? 'bg-red-600 text-white hover:bg-red-700'
                                : 'bg-[#E5A93C] text-[#0B0D13] hover:bg-[#eeb954]'}`, children: confirmLabel })] })] }) }));
};
//# sourceMappingURL=KeyringConfirmDialog.js.map