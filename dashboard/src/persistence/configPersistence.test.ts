import { describe, expect, it, vi } from "vitest";

import { createConfigPersistence } from "./configPersistence";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("configPersistence", () => {
  it("keeps the newest optimistic value while an older save resolves first", async () => {
    const first = deferred<{ value: number }>();
    const second = deferred<{ value: number }>();
    const save = vi
      .fn<(_: { value: number }) => Promise<{ value: number }>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const controller = createConfigPersistence({
      initialValue: { value: 1 },
      save,
    });

    controller.applyOptimisticChange(() => ({ value: 2 }));
    const flush = controller.flushNow();

    controller.applyOptimisticChange(() => ({ value: 3 }));
    const secondFlush = controller.flushNow();

    expect(controller.getSnapshot().optimisticValue.value).toBe(3);

    first.resolve({ value: 2 });
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getSnapshot().confirmedValue.value).toBe(2);
    expect(controller.getSnapshot().optimisticValue.value).toBe(3);

    second.resolve({ value: 3 });
    await flush;
    await secondFlush;

    expect(controller.getSnapshot().confirmedValue.value).toBe(3);
    expect(controller.getSnapshot().optimisticValue.value).toBe(3);
  });

  it("keeps an offline edit queued instead of reverting it", async () => {
    const failing = deferred<{ value: number }>();
    const save = vi.fn().mockImplementationOnce(() => failing.promise);
    const controller = createConfigPersistence({
      initialValue: { value: 4 },
      save,
    });

    controller.applyOptimisticChange(() => ({ value: 5 }));
    const flush = controller.flushNow();

    failing.reject(new Error("save failed"));

    await expect(flush).rejects.toThrow("save failed");
    expect(controller.getSnapshot().confirmedValue.value).toBe(4);
    expect(controller.getSnapshot().optimisticValue.value).toBe(5);
    expect(controller.getSnapshot().dirty).toBe(true);
    expect(controller.getSnapshot().saveState).toBe("offline");
  });

  it("lets the user choose the server version after a revision conflict", async () => {
    const conflict = Object.assign(new Error("revision conflict"), {
      serverValue: { value: 9 },
    });
    const controller = createConfigPersistence({
      initialValue: { value: 4 },
      save: vi.fn().mockRejectedValueOnce(conflict),
    });

    controller.applyOptimisticChange(() => ({ value: 5 }));
    await expect(controller.flushNow()).rejects.toThrow("revision conflict");

    expect(controller.getSnapshot().saveState).toBe("conflict");
    expect(controller.getSnapshot().conflict).toEqual({
      localValue: { value: 5 },
      serverValue: { value: 9 },
    });

    controller.resolveConflictWithServer();
    expect(controller.getSnapshot()).toMatchObject({
      confirmedValue: { value: 9 },
      optimisticValue: { value: 9 },
      saveState: "clean",
      dirty: false,
      conflict: null,
    });
  });

  it("retries the local version against the conflict revision when chosen", async () => {
    const conflict = Object.assign(new Error("revision conflict"), {
      serverValue: { value: 9 },
    });
    const save = vi
      .fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ value: 5 });
    const controller = createConfigPersistence({
      initialValue: { value: 4 },
      save,
    });

    controller.applyOptimisticChange(() => ({ value: 5 }));
    await expect(controller.flushNow()).rejects.toThrow("revision conflict");
    await controller.resolveConflictKeepLocal();

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ value: 5 });
    expect(controller.getSnapshot()).toMatchObject({
      confirmedValue: { value: 5 },
      optimisticValue: { value: 5 },
      saveState: "clean",
      dirty: false,
      conflict: null,
    });
  });
});
