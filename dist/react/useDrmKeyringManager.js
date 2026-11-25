import { useSyncExternalStore } from 'react';
export function useDrmKeyringManager(manager) {
    return useSyncExternalStore((onStoreChange) => manager.subscribe(onStoreChange), () => manager.getState(), () => manager.getState());
}
//# sourceMappingURL=useDrmKeyringManager.js.map