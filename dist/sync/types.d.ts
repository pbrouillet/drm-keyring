import type { DrmKeyringEncryptedBackup, RemoteKeyringSummary } from '../types.js';
export interface CloudKeyringSyncProvider {
    inspect(options?: {
        interactive?: boolean;
    }): Promise<RemoteKeyringSummary | null>;
    pull(options?: {
        interactive?: boolean;
    }): Promise<DrmKeyringEncryptedBackup | null>;
    push(backup: DrmKeyringEncryptedBackup, options?: {
        interactive?: boolean;
    }): Promise<RemoteKeyringSummary>;
    delete(options?: {
        interactive?: boolean;
    }): Promise<void>;
}
export declare class MemoryCloudKeyringSyncProvider implements CloudKeyringSyncProvider {
    private remoteBackup;
    private modifiedTime;
    private readonly fileId;
    constructor(initialBackup?: DrmKeyringEncryptedBackup | null, fileId?: string);
    private buildSummary;
    inspect(): Promise<RemoteKeyringSummary | null>;
    pull(): Promise<DrmKeyringEncryptedBackup | null>;
    push(backup: DrmKeyringEncryptedBackup): Promise<RemoteKeyringSummary>;
    delete(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map