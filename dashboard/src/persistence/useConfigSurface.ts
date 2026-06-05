import { useEffect, useRef, useState } from "react";

import {
  createConfigPersistence,
  type ConfigPersistenceSnapshot,
} from "./configPersistence";

interface UseConfigSurfaceOptions<T> {
  initialValue: T;
  save: (nextValue: T) => Promise<T>;
}

export function useConfigSurface<T>(options: UseConfigSurfaceOptions<T>) {
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
    return controllerRef.current.subscribe(setSnapshot);
  }, []);

  return {
    value: snapshot.optimisticValue,
    confirmedValue: snapshot.confirmedValue,
    saveState: snapshot.saveState,
    errorMessage: snapshot.errorMessage,
    dirty: snapshot.dirty,
    hydrateConfirmed: controllerRef.current.hydrateConfirmed,
    applyOptimisticChange: controllerRef.current.applyOptimisticChange,
    scheduleDebouncedSave: controllerRef.current.scheduleDebouncedSave,
    requestImmediateSave: controllerRef.current.requestImmediateSave,
    flushNow: controllerRef.current.flushNow,
    cancelDebounce: controllerRef.current.cancelDebounce,
  };
}
