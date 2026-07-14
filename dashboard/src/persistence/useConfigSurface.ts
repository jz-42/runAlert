import { useEffect, useRef, useState } from "react";

import {
  createConfigPersistence,
  type ConfigPersistenceSnapshot,
} from "./configPersistence";

interface UseConfigSurfaceOptions<T> {
  initialValue: T;
  save: (nextValue: T) => Promise<T>;
  offlineStorageKey?: string;
}

function readPendingValue<T>(storageKey?: string): T | null {
  if (!storageKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function useConfigSurface<T>(options: UseConfigSurfaceOptions<T>) {
  const pendingValueRef = useRef<T | null>(
    readPendingValue<T>(options.offlineStorageKey)
  );
  const controllerRef = useRef(
    createConfigPersistence<T>({
      initialValue: options.initialValue,
      save: options.save,
    })
  );
  const [snapshot, setSnapshot] = useState<ConfigPersistenceSnapshot<T>>(
    controllerRef.current.getSnapshot()
  );

  useEffect(() => {
    controllerRef.current.setSave(options.save);
  }, [options.save]);

  useEffect(() => {
    return controllerRef.current.subscribe((next) => {
      setSnapshot(next);
      if (!options.offlineStorageKey || typeof window === "undefined") return;
      try {
        if (next.dirty && next.optimisticValue != null) {
          window.localStorage.setItem(
            options.offlineStorageKey,
            JSON.stringify(next.optimisticValue)
          );
        } else {
          window.localStorage.removeItem(options.offlineStorageKey);
        }
      } catch {
        // The in-memory queue still protects the current session.
      }
    });
  }, [options.offlineStorageKey]);

  useEffect(() => {
    const retry = () => {
      if (controllerRef.current.getSnapshot().saveState === "offline") {
        void controllerRef.current.retrySave().catch(() => {});
      }
    };
    window.addEventListener("online", retry);
    const interval = window.setInterval(retry, 30_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(interval);
    };
  }, []);

  function hydrateConfirmed(value: T) {
    controllerRef.current.hydrateConfirmed(value);
    if (pendingValueRef.current == null) return;
    const pending = pendingValueRef.current;
    pendingValueRef.current = null;
    controllerRef.current.applyOptimisticChange(() => pending);
    void controllerRef.current.retrySave().catch(() => {});
  }

  return {
    value: snapshot.optimisticValue,
    confirmedValue: snapshot.confirmedValue,
    saveState: snapshot.saveState,
    errorMessage: snapshot.errorMessage,
    dirty: snapshot.dirty,
    conflict: snapshot.conflict,
    hydrateConfirmed,
    applyOptimisticChange: controllerRef.current.applyOptimisticChange,
    scheduleDebouncedSave: controllerRef.current.scheduleDebouncedSave,
    requestImmediateSave: controllerRef.current.requestImmediateSave,
    flushNow: controllerRef.current.flushNow,
    cancelDebounce: controllerRef.current.cancelDebounce,
    retrySave: controllerRef.current.retrySave,
    resolveConflictWithServer: controllerRef.current.resolveConflictWithServer,
    resolveConflictKeepLocal: controllerRef.current.resolveConflictKeepLocal,
  };
}
