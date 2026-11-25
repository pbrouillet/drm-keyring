export class DrmAuthenticationError extends Error {
    constructor(message = 'Incorrect passphrase or corrupted encrypted archive. Authentication tag verification failed.') {
        super(message);
        this.name = 'DrmAuthenticationError';
    }
}
export class DrmContainerFormatError extends Error {
    constructor(message = 'Invalid or unsupported .ndrm encrypted book container.') {
        super(message);
        this.name = 'DrmContainerFormatError';
    }
}
export class KeyringSyncAuthExpiredError extends Error {
    constructor(message = 'Cloud sync session expired. Please reconnect.') {
        super(message);
        this.name = 'KeyringSyncAuthExpiredError';
    }
}
export class KeyringSyncPermissionScopeError extends Error {
    constructor(message = 'Cloud storage permission was not granted during sign-in. Reconnect and approve access.') {
        super(message);
        this.name = 'KeyringSyncPermissionScopeError';
    }
}
export class KeyringSyncApiNotEnabledError extends Error {
    constructor(message = 'Cloud storage API is still activating or not enabled for this project.') {
        super(message);
        this.name = 'KeyringSyncApiNotEnabledError';
    }
}
//# sourceMappingURL=errors.js.map