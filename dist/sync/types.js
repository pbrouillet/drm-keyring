export class MemoryCloudKeyringSyncProvider {
    remoteBackup;
    modifiedTime;
    fileId;
    constructor(initialBackup = null, fileId = 'memory-keyring-1') {
        this.remoteBackup = initialBackup ? structuredClone(initialBackup) : null;
        this.modifiedTime = new Date().toISOString();
        this.fileId = fileId;
    }
    buildSummary(backup) {
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
    async inspect() {
        if (!this.remoteBackup)
            return null;
        return this.buildSummary(this.remoteBackup);
    }
    async pull() {
        if (!this.remoteBackup)
            return null;
        return structuredClone(this.remoteBackup);
    }
    async push(backup) {
        this.remoteBackup = structuredClone(backup);
        this.modifiedTime = new Date().toISOString();
        return this.buildSummary(this.remoteBackup);
    }
    async delete() {
        this.remoteBackup = null;
    }
}
//# sourceMappingURL=types.js.map