import React from 'react';
export interface KeyringConfirmDialogProps {
    open: boolean;
    title: string;
    description: string;
    details?: string[];
    confirmLabel: string;
    destructive?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}
export declare const KeyringConfirmDialog: React.FC<KeyringConfirmDialogProps>;
//# sourceMappingURL=KeyringConfirmDialog.d.ts.map