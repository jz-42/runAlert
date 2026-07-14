export type SaveState = "clean" | "dirty" | "saving" | "offline" | "conflict";

export interface ConfigConflict<T> {
  localValue: T;
  serverValue: T;
}

export interface ConfigPersistenceSnapshot<T> {
  confirmedValue: T;
  optimisticValue: T;
  saveState: SaveState;
  errorMessage: string | null;
  dirty: boolean;
  conflict: ConfigConflict<T> | null;
}

interface CreateConfigPersistenceOptions<T> {
  initialValue: T;
  save: (nextValue: T) => Promise<T>;
  onChange?: (snapshot: ConfigPersistenceSnapshot<T>) => void;
}

export interface ConfigPersistenceController<T> {
  getSnapshot(): ConfigPersistenceSnapshot<T>;
  hydrateConfirmed(value: T): void;
  setSave(save: (nextValue: T) => Promise<T>): void;
  applyOptimisticChange(updater: (current: T) => T): void;
  scheduleDebouncedSave(delayMs: number): void;
  requestImmediateSave(): Promise<void>;
  flushNow(): Promise<void>;
  cancelDebounce(): void;
  retrySave(): Promise<void>;
  resolveConflictWithServer(): void;
  resolveConflictKeepLocal(): Promise<void>;
  subscribe(listener: (snapshot: ConfigPersistenceSnapshot<T>) => void): () => void;
}

export function createConfigPersistence<T>(
  options: CreateConfigPersistenceOptions<T>
): ConfigPersistenceController<T> {
  let save = options.save;
  let confirmedValue = options.initialValue;
  let optimisticValue = options.initialValue;
  let saveState: SaveState = "clean";
  let errorMessage: string | null = null;
  let conflict: ConfigConflict<T> | null = null;
  let dirty = false;
  let latestVersion = 0;
  let inFlightVersion = 0;
  let inFlight = false;
  let inFlightPromise: Promise<void> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(snapshot: ConfigPersistenceSnapshot<T>) => void>();
  const idleResolvers = new Set<() => void>();

  function snapshot(): ConfigPersistenceSnapshot<T> {
    return {
      confirmedValue,
      optimisticValue,
      saveState,
      errorMessage,
      dirty,
      conflict,
    };
  }

  function emit() {
    const next = snapshot();
    options.onChange?.(next);
    for (const listener of listeners) listener(next);
    if (!inFlight && !dirty && !debounceTimer) {
      for (const resolve of idleResolvers) resolve();
      idleResolvers.clear();
    }
  }

  function waitForIdle() {
    if (!inFlight && !dirty && !debounceTimer) return Promise.resolve();
    return new Promise<void>((resolve) => {
      idleResolvers.add(resolve);
    });
  }

  function cancelDebounce() {
    if (!debounceTimer) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    emit();
  }

  function maybeStartSave() {
    if (
      inFlight ||
      !dirty ||
      saveState === "offline" ||
      saveState === "conflict"
    ) {
      return;
    }

    const version = latestVersion;
    const valueToSave = optimisticValue;
    inFlight = true;
    inFlightVersion = version;
    saveState = "saving";
    errorMessage = null;
    emit();

    inFlightPromise = save(valueToSave)
      .then((savedValue) => {
        confirmedValue = savedValue;
        if (latestVersion === version) {
          optimisticValue = savedValue;
          dirty = false;
          saveState = "clean";
          errorMessage = null;
          conflict = null;
        } else {
          saveState = "dirty";
        }
      })
      .catch((error) => {
        if (latestVersion === version) {
          dirty = true;
          errorMessage = error?.message ?? String(error);
          if (error && typeof error === "object" && "serverValue" in error) {
            conflict = {
              localValue: optimisticValue,
              serverValue: error.serverValue as T,
            };
            saveState = "conflict";
          } else {
            conflict = null;
            saveState = "offline";
          }
        } else {
          saveState = "dirty";
        }
      })
      .finally(() => {
        inFlight = false;
        inFlightPromise = null;
        emit();
        if (dirty && saveState === "dirty") maybeStartSave();
      });
  }

  async function saveUntilSettled({ retryOffline = true } = {}) {
    cancelDebounce();
    if (saveState === "conflict") {
      throw new Error(errorMessage || "Synced settings conflict requires a choice.");
    }
    if (saveState === "offline" && retryOffline) {
      saveState = "dirty";
      errorMessage = null;
      emit();
    }
    maybeStartSave();
    while (inFlightPromise || (dirty && saveState === "dirty")) {
      if (inFlightPromise) await inFlightPromise;
      if (!inFlightPromise && dirty && saveState === "dirty") maybeStartSave();
    }
    if (
      (saveState === "offline" || saveState === "conflict") &&
      errorMessage
    ) {
      throw new Error(errorMessage);
    }
    await waitForIdle();
  }

  return {
    getSnapshot() {
      return snapshot();
    },
    hydrateConfirmed(value) {
      confirmedValue = value;
      optimisticValue = value;
      saveState = "clean";
      errorMessage = null;
      dirty = false;
      conflict = null;
      cancelDebounce();
      emit();
    },
    setSave(nextSave) {
      save = nextSave;
    },
    applyOptimisticChange(updater) {
      optimisticValue = updater(optimisticValue);
      latestVersion += 1;
      dirty = true;
      if (saveState === "conflict" && conflict) {
        conflict = { ...conflict, localValue: optimisticValue };
      } else {
        saveState = "dirty";
        conflict = null;
      }
      errorMessage = null;
      emit();
    },
    scheduleDebouncedSave(delayMs) {
      cancelDebounce();
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        emit();
        maybeStartSave();
      }, delayMs);
      emit();
    },
    async requestImmediateSave() {
      await saveUntilSettled();
    },
    async flushNow() {
      await saveUntilSettled();
    },
    async retrySave() {
      await saveUntilSettled();
    },
    resolveConflictWithServer() {
      if (!conflict) return;
      latestVersion += 1;
      confirmedValue = conflict.serverValue;
      optimisticValue = conflict.serverValue;
      dirty = false;
      saveState = "clean";
      errorMessage = null;
      conflict = null;
      emit();
    },
    async resolveConflictKeepLocal() {
      if (!conflict) return;
      conflict = null;
      saveState = "dirty";
      errorMessage = null;
      emit();
      await saveUntilSettled({ retryOffline: false });
    },
    cancelDebounce,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
