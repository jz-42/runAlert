export type SaveState = "clean" | "dirty" | "saving" | "error";

export interface ConfigPersistenceSnapshot<T> {
  confirmedValue: T;
  optimisticValue: T;
  saveState: SaveState;
  errorMessage: string | null;
  dirty: boolean;
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
    if (inFlight || !dirty) return;

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
        } else {
          saveState = "dirty";
        }
      })
      .catch((error) => {
        if (latestVersion === version) {
          optimisticValue = confirmedValue;
          dirty = false;
          saveState = "error";
          errorMessage = error?.message ?? String(error);
        } else {
          saveState = "dirty";
        }
      })
      .finally(() => {
        inFlight = false;
        inFlightPromise = null;
        emit();
        if (dirty) maybeStartSave();
      });
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
      saveState = "dirty";
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
      cancelDebounce();
      maybeStartSave();
      if (inFlightPromise) await inFlightPromise;
    },
    async flushNow() {
      cancelDebounce();
      maybeStartSave();
      while (inFlightPromise || dirty) {
        if (inFlightPromise) await inFlightPromise;
        if (!inFlightPromise && dirty) maybeStartSave();
      }
      await waitForIdle();
      if (saveState === "error" && errorMessage) {
        throw new Error(errorMessage);
      }
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
