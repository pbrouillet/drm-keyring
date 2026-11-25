import React from 'react';
import type { DrmManagedKey, DrmProtectedItem, RemoteKeyringSummary } from '../types.js';
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
    onRotateKey: (submission: RotateDrmKeySubmission) => Promise<{
        rotatedBookCount: number;
    }>;
    onSetDefaultKey: (keyId: string) => Promise<void>;
    onDeleteLocalKey: (keyId: string) => Promise<void>;
    onBackupKeyringToDrive: (backupPassphrase: string, backupHint: string) => Promise<void>;
    onRestoreKeyringFromDrive: (backupPassphrase: string, strategy: 'merge' | 'replace') => Promise<{
        restoredCount: number;
    }>;
    onDeleteDriveKeyringBackup: () => Promise<void>;
    onExportLocalKeyringFile: (backupPassphrase: string, backupHint: string) => Promise<void>;
    onImportLocalKeyringFile: (rawJson: string, backupPassphrase: string, strategy: 'merge' | 'replace') => Promise<{
        restoredCount: number;
    }>;
}
export declare function DrmKeyVaultPanel<TItem extends DrmProtectedItem = DrmProtectedItem>({ drmKeys, items, libraryBooks, isDriveConnected, isDriveSessionLive, isSigningIn, remoteDriveBackup, isInspectingDriveBackup, providerLabel, remoteFileName, renderConnectButton, onConnectDrive, onRefreshDriveBackupStatus, onCreateKey, onRotateKey, onSetDefaultKey, onDeleteLocalKey, onBackupKeyringToDrive, onRestoreKeyringFromDrive, onDeleteDriveKeyringBackup, onExportLocalKeyringFile, onImportLocalKeyringFile, }: DrmKeyVaultPanelProps<TItem>): React.ReactElement;
//# sourceMappingURL=DrmKeyVaultPanel.d.ts.map