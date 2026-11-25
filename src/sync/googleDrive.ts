import { DEFAULT_DRM_PROTOCOL_PROFILE, DEFAULT_KEYRING_FILENAME } from '../constants.js';
import {
  KeyringSyncApiNotEnabledError,
  KeyringSyncAuthExpiredError,
  KeyringSyncPermissionScopeError,
} from '../errors.js';
import { parseDrmKeyringBackupJson } from '../keyringCrypto.js';
import type {
  DrmKeyringBackupHeader,
  DrmKeyringEncryptedBackup,
  RemoteKeyringSummary,
} from '../types.js';
import type { CloudKeyringSyncProvider } from './types.js';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

export interface DriveKeyringApiOptions {
  fileName?: string;
  expectedAppId?: string;
  fetchImpl?: typeof fetch;
  classifyError?: (status: number, body: string, contextMessage: string) => Error;
}

function extractDriveApiErrorMessage(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return 'Unknown error';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: {
        message?: string;
        errors?: { message?: string; location?: string; reason?: string }[];
      };
    };
    const firstDetail = parsed.error?.errors?.[0];
    const baseMessage = firstDetail?.message || parsed.error?.message;
    if (baseMessage) {
      const locationSuffix = firstDetail?.location ? ` (${firstDetail.location})` : '';
      return `${baseMessage}${locationSuffix}`;
    }
  } catch {
    // Fall back to condensed plain-text body when response is not JSON
  }
  return trimmed.replace(/\s+/g, ' ').slice(0, 160);
}

export function classifyKeyringDriveApiError(
  status: number,
  rawBody: string,
  contextMessage = 'Google Drive request failed'
): Error {
  const detail = extractDriveApiErrorMessage(rawBody);
  let reason = '';
  let errorInfoReason = '';

  try {
    const parsed = JSON.parse(rawBody.trim()) as {
      error?: {
        status?: string;
        errors?: { reason?: string }[];
        details?: { reason?: string }[];
      };
    };
    reason = parsed.error?.errors?.[0]?.reason ?? '';
    errorInfoReason = parsed.error?.details?.find((d) => Boolean(d.reason))?.reason ?? '';
  } catch {
    // Ignore non-JSON bodies
  }

  if (status === 401 || reason === 'authError' || reason === 'unauthorized') {
    return new KeyringSyncAuthExpiredError('Google Drive session expired. Please reconnect.');
  }

  if (status === 403) {
    const combined = `${reason} ${errorInfoReason} ${detail}`.toLowerCase();
    if (
      reason === 'accessNotConfigured' ||
      errorInfoReason === 'SERVICE_DISABLED' ||
      combined.includes('has not been used in project') ||
      combined.includes('api has not been used') ||
      combined.includes('drive.googleapis.com')
    ) {
      return new KeyringSyncApiNotEnabledError(
        'Google Drive API is still activating or not enabled for this Google Cloud project.'
      );
    }

    if (
      reason === 'insufficientPermissions' ||
      errorInfoReason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' ||
      combined.includes('insufficient authentication scopes') ||
      combined.includes('insufficient permission')
    ) {
      return new KeyringSyncPermissionScopeError(
        'Google Drive permission was not granted during sign-in. Reconnect and approve Google Drive access.'
      );
    }
  }

  return new Error(`${contextMessage} (${status}): ${detail}`);
}

function isAuthOrScopeError(err: unknown): boolean {
  if (
    err instanceof KeyringSyncAuthExpiredError ||
    err instanceof KeyringSyncPermissionScopeError ||
    err instanceof KeyringSyncApiNotEnabledError
  ) {
    return true;
  }
  if (err instanceof Error) {
    return (
      err.name === 'DriveAuthExpiredError' ||
      err.name === 'DrivePermissionScopeError' ||
      err.name === 'DriveApiNotEnabledError'
    );
  }
  return false;
}

async function findDriveDrmKeyringBackupFile(
  accessToken: string,
  options?: DriveKeyringApiOptions
): Promise<{ id: string; modifiedTime: string; sizeBytes: number } | null> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const fileName = options?.fileName ?? DEFAULT_KEYRING_FILENAME;
  const classify = options?.classifyError ?? classifyKeyringDriveApiError;

  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${fileName}' and trashed = false`,
    pageSize: '1',
    orderBy: 'modifiedTime desc',
    fields: 'files(id, modifiedTime, size)',
  });

  const res = await fetchFn(`${DRIVE_API_BASE}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw classify(res.status, body, 'Failed to inspect Google Drive DRM keyring space');
  }

  const data = (await res.json()) as {
    files?: { id: string; modifiedTime?: string; size?: string }[];
  };
  const first = data.files?.[0];
  if (!first?.id) return null;

  return {
    id: first.id,
    modifiedTime: first.modifiedTime ?? new Date().toISOString(),
    sizeBytes: first.size ? Number.parseInt(first.size, 10) || 0 : 0,
  };
}

export async function inspectDriveDrmKeyringBackup(
  accessToken: string,
  options?: DriveKeyringApiOptions
): Promise<RemoteKeyringSummary | null> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const classify = options?.classifyError ?? classifyKeyringDriveApiError;
  const expectedAppId = options?.expectedAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyringBackupAppId;

  const found = await findDriveDrmKeyringBackupFile(accessToken, options);
  if (!found) return null;

  let header: DrmKeyringBackupHeader | undefined;
  try {
    const res = await fetchFn(`${DRIVE_API_BASE}/files/${encodeURIComponent(found.id)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => '');
      throw classify(res.status, body, 'Failed to inspect DRM keyring backup in Google Drive');
    }
    if (res.ok) {
      const rawText = await res.text();
      const parsed = parseDrmKeyringBackupJson(rawText, { expectedAppId });
      header = {
        schemaVersion: 1,
        app: parsed.app,
        backupId: parsed.backupId,
        createdAt: parsed.createdAt,
        keyCount: parsed.keyCount,
        keyFingerprints: parsed.keyFingerprints,
        ...(parsed.backupHint ? { backupHint: parsed.backupHint } : {}),
      };
    }
  } catch (err) {
    if (isAuthOrScopeError(err)) {
      throw err;
    }
    // Still surface file summary if header parse failed
  }

  return {
    fileId: found.id,
    modifiedTime: found.modifiedTime,
    sizeBytes: found.sizeBytes,
    header,
  };
}

export async function pullDrmKeyringBackupFromDrive(
  accessToken: string,
  options?: DriveKeyringApiOptions
): Promise<DrmKeyringEncryptedBackup | null> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const classify = options?.classifyError ?? classifyKeyringDriveApiError;
  const expectedAppId = options?.expectedAppId ?? DEFAULT_DRM_PROTOCOL_PROFILE.keyringBackupAppId;

  const found = await findDriveDrmKeyringBackupFile(accessToken, options);
  if (!found) return null;

  const res = await fetchFn(`${DRIVE_API_BASE}/files/${encodeURIComponent(found.id)}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw classify(res.status, body, 'Failed to download DRM keyring backup from Google Drive');
  }

  const rawText = await res.text();
  return parseDrmKeyringBackupJson(rawText, { expectedAppId });
}

export async function pushDrmKeyringBackupToDrive(
  accessToken: string,
  backup: DrmKeyringEncryptedBackup,
  options?: DriveKeyringApiOptions
): Promise<RemoteKeyringSummary> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const fileName = options?.fileName ?? DEFAULT_KEYRING_FILENAME;
  const classify = options?.classifyError ?? classifyKeyringDriveApiError;

  const existing = await findDriveDrmKeyringBackupFile(accessToken, options);
  const jsonContent = JSON.stringify(backup);
  const contentBytes = new TextEncoder().encode(jsonContent).byteLength;

  if (existing) {
    const res = await fetchFn(
      `${DRIVE_UPLOAD_BASE}/files/${encodeURIComponent(existing.id)}?uploadType=media&fields=id,modifiedTime,size`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: jsonContent,
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw classify(res.status, body, 'Failed to update DRM keyring backup in Google Drive');
    }
    const updated = (await res.json().catch(() => ({}))) as {
      id?: string;
      modifiedTime?: string;
      size?: string;
    };
    return {
      fileId: updated.id ?? existing.id,
      modifiedTime: updated.modifiedTime ?? new Date().toISOString(),
      sizeBytes: updated.size ? Number.parseInt(updated.size, 10) || contentBytes : contentBytes,
      header: {
        schemaVersion: 1,
        app: backup.app,
        backupId: backup.backupId,
        createdAt: backup.createdAt,
        keyCount: backup.keyCount,
        keyFingerprints: backup.keyFingerprints,
        ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
      },
    };
  }

  const boundary = 'nocturne_drm_keyring_boundary_7419';
  const metadata = JSON.stringify({
    name: fileName,
    parents: ['appDataFolder'],
    mimeType: 'application/json',
  });

  const multipartBody =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const res = await fetchFn(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,modifiedTime,size`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw classify(res.status, body, 'Failed to save DRM keyring backup to Google Drive');
  }

  const created = (await res.json().catch(() => ({}))) as {
    id?: string;
    modifiedTime?: string;
    size?: string;
  };
  return {
    fileId: created.id ?? 'drive-appdata-keyring',
    modifiedTime: created.modifiedTime ?? new Date().toISOString(),
    sizeBytes: created.size ? Number.parseInt(created.size, 10) || contentBytes : contentBytes,
    header: {
      schemaVersion: 1,
      app: backup.app,
      backupId: backup.backupId,
      createdAt: backup.createdAt,
      keyCount: backup.keyCount,
      keyFingerprints: backup.keyFingerprints,
      ...(backup.backupHint ? { backupHint: backup.backupHint } : {}),
    },
  };
}

export async function deleteDrmKeyringBackupFromDrive(
  accessToken: string,
  options?: DriveKeyringApiOptions
): Promise<void> {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch;
  const classify = options?.classifyError ?? classifyKeyringDriveApiError;

  const existing = await findDriveDrmKeyringBackupFile(accessToken, options);
  if (!existing) return;

  const res = await fetchFn(`${DRIVE_API_BASE}/files/${encodeURIComponent(existing.id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    const body = await res.text().catch(() => '');
    throw classify(res.status, body, 'Failed to delete Google Drive DRM keyring backup');
  }
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete Google Drive DRM keyring backup (${res.status})`);
  }
}

export interface GoogleDriveKeyringSyncProviderOptions extends DriveKeyringApiOptions {
  getAccessToken: (options?: { interactive?: boolean }) => Promise<string | null>;
  onAuthExpired?: () => void;
  onPermissionScopeError?: () => void;
}

export class GoogleDriveKeyringSyncProvider implements CloudKeyringSyncProvider {
  private readonly options: GoogleDriveKeyringSyncProviderOptions;

  constructor(options: GoogleDriveKeyringSyncProviderOptions) {
    this.options = options;
  }

  private get apiOptions(): DriveKeyringApiOptions {
    return {
      fileName: this.options.fileName,
      expectedAppId: this.options.expectedAppId,
      fetchImpl: this.options.fetchImpl,
      classifyError: this.options.classifyError,
    };
  }

  private async requireToken(interactive: boolean): Promise<string> {
    const token = await this.options.getAccessToken({ interactive });
    if (!token) {
      throw new KeyringSyncAuthExpiredError(
        'Connect Google Drive to inspect or synchronize your DRM keyring.'
      );
    }
    return token;
  }

  private handleError(err: unknown): never {
    if (
      err instanceof KeyringSyncAuthExpiredError ||
      (err instanceof Error && err.name === 'DriveAuthExpiredError')
    ) {
      this.options.onAuthExpired?.();
    } else if (
      err instanceof KeyringSyncPermissionScopeError ||
      (err instanceof Error && err.name === 'DrivePermissionScopeError')
    ) {
      this.options.onPermissionScopeError?.();
    }
    throw err;
  }

  async inspect(options?: { interactive?: boolean }): Promise<RemoteKeyringSummary | null> {
    const interactive = options?.interactive ?? false;
    const token = await this.options.getAccessToken({ interactive });
    if (!token) {
      return null;
    }
    try {
      return await inspectDriveDrmKeyringBackup(token, this.apiOptions);
    } catch (err) {
      this.handleError(err);
    }
  }

  async pull(options?: { interactive?: boolean }): Promise<DrmKeyringEncryptedBackup | null> {
    const token = await this.requireToken(options?.interactive ?? true);
    try {
      return await pullDrmKeyringBackupFromDrive(token, this.apiOptions);
    } catch (err) {
      this.handleError(err);
    }
  }

  async push(
    backup: DrmKeyringEncryptedBackup,
    options?: { interactive?: boolean }
  ): Promise<RemoteKeyringSummary> {
    const token = await this.requireToken(options?.interactive ?? true);
    try {
      return await pushDrmKeyringBackupToDrive(token, backup, this.apiOptions);
    } catch (err) {
      this.handleError(err);
    }
  }

  async delete(options?: { interactive?: boolean }): Promise<void> {
    const token = await this.requireToken(options?.interactive ?? true);
    try {
      await deleteDrmKeyringBackupFromDrive(token, this.apiOptions);
    } catch (err) {
      this.handleError(err);
    }
  }
}
