import { describe, expect, it, vi } from "vitest";
import { writeTextToClipboard } from "./clipboard";

describe("writeTextToClipboard", () => {
  it("prefers the Clipboard API when it succeeds", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const fallbackCopy = vi.fn().mockReturnValue(false);

    const copied = await writeTextToClipboard("https://poker.example.com/room/ABCD", {
      clipboard: { writeText },
      fallbackCopy,
    });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://poker.example.com/room/ABCD");
    expect(fallbackCopy).not.toHaveBeenCalled();
  });

  it("falls back to the legacy copy path when the Clipboard API fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("blocked"));
    const fallbackCopy = vi.fn().mockReturnValue(true);

    const copied = await writeTextToClipboard("https://poker.example.com/room/ABCD", {
      clipboard: { writeText },
      fallbackCopy,
    });

    expect(copied).toBe(true);
    expect(fallbackCopy).toHaveBeenCalledWith("https://poker.example.com/room/ABCD");
  });

  it("returns false when both clipboard paths fail", async () => {
    const copied = await writeTextToClipboard("https://poker.example.com/room/ABCD", {
      clipboard: null,
      fallbackCopy: () => false,
    });

    expect(copied).toBe(false);
  });
});
