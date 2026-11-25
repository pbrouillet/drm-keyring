import React from 'react';
import type { DrmManagedKey, RemoteKeyringSummary } from '../types.js';
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
    }) => Promise<{
        mergedCount: number;
        pushed: boolean;
    }>;
    onSyncKeyringNow: () => Promise<{
        mergedCount: number;
        pushed: boolean;
    }>;
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
export declare const CloudKeyringPanel: React.FC<CloudKeyringPanelProps>;
//# sourceMappingURL=CloudKeyringPanel.d.ts.map