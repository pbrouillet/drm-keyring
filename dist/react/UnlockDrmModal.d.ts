import React from 'react';
import type { DrmManagedKey, DrmProtectedItem } from '../types.js';
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
export declare function UnlockDrmModal<TItem extends DrmProtectedItem = DrmProtectedItem>({ mode, book, drmKeys, onUnlock, onEncrypt, onRotate, onOpenKeyVault, onClose, }: UnlockDrmModalProps<TItem>): React.ReactElement | null;
//# sourceMappingURL=UnlockDrmModal.d.ts.map