import { describe, expect, it } from "vitest";
import {
  buildPendingInviteAuthPath,
  clearPendingInviteRoom,
  consumePendingInviteRoom,
  normalizePendingInviteRoomId,
  readPendingInviteRoom,
  readPendingInviteRoomIdFromSearch,
  syncPendingInviteRoomFromSearch,
  writePendingInviteRoom,
} from "./pending-invite-room";

const createStorage = () => {
  const values = new Map<string, string>();

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
};

describe("pending invite room helpers", () => {
  it("normalizes valid room ids and rejects invalid ones", () => {
    expect(normalizePendingInviteRoomId(" ab23cd ")).toBe("AB23CD");
    expect(normalizePendingInviteRoomId("O12345")).toBeNull();
    expect(normalizePendingInviteRoomId("ABC")).toBeNull();
  });

  it("builds the auth redirect path with the normalized room id", () => {
    expect(buildPendingInviteAuthPath("ab23cd")).toBe("/auth?roomId=AB23CD");
    expect(buildPendingInviteAuthPath("bad")).toBe("/auth");
  });

  it("reads room id from search and stores a backup copy", () => {
    const storage = createStorage();
    expect(readPendingInviteRoomIdFromSearch("?roomId=ab23cd")).toBe("AB23CD");
    expect(syncPendingInviteRoomFromSearch("?roomId=ab23cd", storage, 100)).toBe(
      "AB23CD",
    );
    expect(readPendingInviteRoom(storage, 100)).toBe("AB23CD");
  });

  it("consumes the query value first and clears the backup after use", () => {
    const storage = createStorage();
    writePendingInviteRoom("ZX34QP", storage, 100);

    expect(consumePendingInviteRoom("?roomId=ab23cd", storage, 200)).toBe(
      "AB23CD",
    );
    expect(readPendingInviteRoom(storage, 200)).toBeNull();
  });

  it("does not revive a stored room id when /auth has no roomId query", () => {
    const storage = createStorage();
    writePendingInviteRoom("ZX34QP", storage, 100);

    expect(readPendingInviteRoom(storage, 200)).toBe("ZX34QP");
    expect(consumePendingInviteRoom("", storage)).toBeNull();
    expect(readPendingInviteRoom(storage, 200)).toBeNull();
  });

  it("clears invalid and expired state instead of reviving stale room ids", () => {
    const storage = createStorage();
    writePendingInviteRoom("ZX34QP", storage, 100);
    expect(readPendingInviteRoom(storage, 100 + 30 * 60 * 1000 + 1)).toBeNull();

    writePendingInviteRoom("ZX34QP", storage, 100);
    expect(syncPendingInviteRoomFromSearch("?roomId=bad", storage, 200)).toBeNull();
    expect(readPendingInviteRoom(storage, 200)).toBeNull();

    writePendingInviteRoom("ZX34QP", storage, 300);
    clearPendingInviteRoom(storage);
    expect(readPendingInviteRoom(storage, 300)).toBeNull();
  });
});
