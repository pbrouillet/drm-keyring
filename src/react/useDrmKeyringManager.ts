import { useSyncExternalStore } from 'react';
import type { DrmKeyringManager, DrmKeyringManagerState } from '../manager.js';

export function useDrmKeyringManager(manager: DrmKeyringManager): DrmKeyringManagerState {
  return useSyncExternalStore(
    (onStoreChange) => manager.subscribe(onStoreChange),
    () => manager.getState(),
    () => manager.getState()
  );
}
