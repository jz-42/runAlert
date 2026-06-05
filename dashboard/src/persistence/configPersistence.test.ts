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

  it("reverts optimistic state to the last confirmed state on failure", async () => {
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
    expect(controller.getSnapshot().optimisticValue.value).toBe(4);
    expect(controller.getSnapshot().saveState).toBe("error");
  });
});
