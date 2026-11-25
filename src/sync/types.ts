import type { DrmKeyringEncryptedBackup, RemoteKeyringSummary } from '../types.js';

export interface CloudKeyringSyncProvider {
  inspect(options?: { interactive?: boolean }): Promise<RemoteKeyringSummary | null>;
  pull(options?: { interactive?: boolean }): Promise<DrmKeyringEncryptedBackup | null>;
  push(
    backup: DrmKeyringEncryptedBackup,
    options?: { interactive?: boolean }
  ): Promise<RemoteKeyringSummary>;
  delete(options?: { interactive?: boolean }): Promise<void>;
}

export class MemoryCloudKeyringSyncProvider implements CloudKeyringSyncProvider {
  private remoteBackup: DrmKeyringEncryptedBackup | null;
  private modifiedTime: string;
  private readonly fileId: string;

  constructor(initialBackup: DrmKeyringEncryptedBackup | null = null, fileId = 'memory-keyring-1') {
    this.remoteBackup = initialBackup ? structuredClone(initialBackup) : null;
    this.modifiedTime = new Date().toISOString();
    this.fileId = fileId;
  }

  private buildSummary(backup: DrmKeyringEncryptedBackup): RemoteKeyringSummary {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(backup)).byteLength;
    return {
      fileId: this.fileId,
      modifiedTime: this.modifiedTime,
      sizeBytes: jsonBytes,
      header: {
        schemaVersion: 1,
        app: backup.app,
        backupId: backup.backupId,
        createdAt: backup.createdAt,
        keyCount: backup.keyCount,
        keyFingerprints: [...backup.keyFingerprints],
        ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
      },
    };
  }

  async inspect(): Promise<RemoteKeyringSummary | null> {
    if (!this.remoteBackup) return null;
    return this.buildSummary(this.remoteBackup);
  }

  async pull(): Promise<DrmKeyringEncryptedBackup | null> {
    if (!this.remoteBackup) return null;
    return structuredClone(this.remoteBackup);
  }

  async push(backup: DrmKeyringEncryptedBackup): Promise<RemoteKeyringSummary> {
    this.remoteBackup = structuredClone(backup);
    this.modifiedTime = new Date().toISOString();
    return this.buildSummary(this.remoteBackup);
  }

  async delete(): Promise<void> {
    this.remoteBackup = null;
  }
}
