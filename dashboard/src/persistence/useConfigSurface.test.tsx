import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useConfigSurface } from "./useConfigSurface";

describe("useConfigSurface", () => {
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
});
