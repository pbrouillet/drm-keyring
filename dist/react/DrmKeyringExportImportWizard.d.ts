import React from 'react';
import type { DrmKeyringEncryptedBackup, DrmManagedKey } from '../types.js';
export type KeyringWizardMode = 'export' | 'import';
export interface DrmKeyringExportImportWizardProps {
    localKeys: DrmManagedKey[];
    initialMode?: KeyringWizardMode;
    appName?: string;
    onClose?: () => void;
    onExportEncryptedBackup: (backupPassphrase: string, backupHint: string) => Promise<{
        backup: DrmKeyringEncryptedBackup;
        fileName: string;
    }>;
    onImportEncryptedBackup: (rawJson: string, backupPassphrase: string, strategy: 'merge' | 'replace') => Promise<{
        restoredCount: number;
        totalKeyCount: number;
    }>;
    onRedownloadSealedBackup?: (backup: DrmKeyringEncryptedBackup, fileName: string) => void;
    onOpenDrmKeyVault?: () => void;
}
export declare const DrmKeyringExportImportWizard: React.FC<DrmKeyringExportImportWizardProps>;
//# sourceMappingURL=DrmKeyringExportImportWizard.d.ts.map