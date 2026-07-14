import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useConfigSurface } from "./useConfigSurface";

describe("useConfigSurface", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });
  it("flushes a pending debounced edit on blur", async () => {
    const save = vi.fn(async (next: { text: string }) => next);

    function Example() {
      const surface = useConfigSurface({
        initialValue: { text: "" },
        save,
      });

      return (
        <input
          aria-label="example"
          value={surface.value.text}
          onChange={(e) => {
            const nextText = e.target.value;
            surface.applyOptimisticChange(() => ({ text: nextText }));
            surface.scheduleDebouncedSave(700);
          }}
          onBlur={() => {
            void surface.flushNow();
          }}
        />
      );
    }

    vi.useFakeTimers();

    render(<Example />);
    const input = screen.getByLabelText("example");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledWith({ text: "abc" });
  });

  it("restores a durable offline edit and retries it after hydration", async () => {
    const queued = { text: "offline edit" };
    window.localStorage.setItem("runalert-pending-config-v1", JSON.stringify(queued));
    const save = vi.fn(async (next: { text: string } | null) => next);

    function Example() {
      const surface = useConfigSurface<{ text: string } | null>({
        initialValue: null,
        save,
        offlineStorageKey: "runalert-pending-config-v1",
      });
      return (
        <button onClick={() => surface.hydrateConfirmed({ text: "server" })}>
          hydrate
        </button>
      );
    }

    render(<Example />);
    fireEvent.click(screen.getByText("hydrate"));

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(queued);
    });
    expect(window.localStorage.getItem("runalert-pending-config-v1")).toBeNull();
  });
});
