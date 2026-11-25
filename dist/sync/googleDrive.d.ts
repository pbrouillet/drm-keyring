import type { DrmKeyringEncryptedBackup, RemoteKeyringSummary } from '../types.js';
import type { CloudKeyringSyncProvider } from './types.js';
export interface DriveKeyringApiOptions {
    fileName?: string;
    expectedAppId?: string;
    fetchImpl?: typeof fetch;
    classifyError?: (status: number, body: string, contextMessage: string) => Error;
}
export declare function classifyKeyringDriveApiError(status: number, rawBody: string, contextMessage?: string): Error;
export declare function inspectDriveDrmKeyringBackup(accessToken: string, options?: DriveKeyringApiOptions): Promise<RemoteKeyringSummary | null>;
export declare function pullDrmKeyringBackupFromDrive(accessToken: string, options?: DriveKeyringApiOptions): Promise<DrmKeyringEncryptedBackup | null>;
export declare function pushDrmKeyringBackupToDrive(accessToken: string, backup: DrmKeyringEncryptedBackup, options?: DriveKeyringApiOptions): Promise<RemoteKeyringSummary>;
export declare function deleteDrmKeyringBackupFromDrive(accessToken: string, options?: DriveKeyringApiOptions): Promise<void>;
export interface GoogleDriveKeyringSyncProviderOptions extends DriveKeyringApiOptions {
    getAccessToken: (options?: {
        interactive?: boolean;
    }) => Promise<string | null>;
    onAuthExpired?: () => void;
    onPermissionScopeError?: () => void;
}
export declare class GoogleDriveKeyringSyncProvider implements CloudKeyringSyncProvider {
    private readonly options;
    constructor(options: GoogleDriveKeyringSyncProviderOptions);
    private get apiOptions();
    private requireToken;
    private handleError;
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
//# sourceMappingURL=googleDrive.d.ts.map