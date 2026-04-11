import { beforeEach, describe, expect, it } from "vitest";
import {
  clearStoredLiveAudioRestoreIntent,
  readStoredLiveAudioRestoreIntent,
  shouldOfferLiveAudioReconnect,
  writeStoredLiveAudioRestoreIntent,
} from "./live-audio-restore-intent";

const createStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};

describe("live audio restore intent", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        sessionStorage: createStorage(),
      },
    });
  });

  it("round-trips normalized room intent through sessionStorage", () => {
    writeStoredLiveAudioRestoreIntent({
      roomId: " room83 ",
      muted: true,
    });

    expect(readStoredLiveAudioRestoreIntent()).toEqual({
      roomId: "ROOM83",
      muted: true,
    });
  });

  it("clears stored intent explicitly", () => {
    writeStoredLiveAudioRestoreIntent({
      roomId: "ROOM83",
      muted: false,
    });

    clearStoredLiveAudioRestoreIntent();

    expect(readStoredLiveAudioRestoreIntent()).toBeNull();
  });

  it("offers reconnect only for the recovered matching room", () => {
    expect(
      shouldOfferLiveAudioReconnect({
        isAuthInitializing: false,
        isAuthenticated: true,
        hasUser: true,
        roomId: "ROOM83",
        isRecoveringSession: false,
        isJoined: false,
        joinedRoomId: null,
        isConnecting: false,
        promptedRoomId: null,
        storedIntent: {
          roomId: "ROOM83",
          muted: true,
        },
      }),
    ).toBe(true);

    expect(
      shouldOfferLiveAudioReconnect({
        isAuthInitializing: false,
        isAuthenticated: true,
        hasUser: true,
        roomId: "ROOM84",
        isRecoveringSession: false,
        isJoined: false,
        joinedRoomId: null,
        isConnecting: false,
        promptedRoomId: null,
        storedIntent: {
          roomId: "ROOM83",
          muted: true,
        },
      }),
    ).toBe(false);
  });

  it("blocks reconnect prompts during auth bootstrap, session recovery, explicit connection, or repeat attempts", () => {
    const base = {
      isAuthInitializing: false,
      isAuthenticated: true,
      hasUser: true,
      roomId: "ROOM83",
      isRecoveringSession: false,
      isJoined: false,
      joinedRoomId: null,
      isConnecting: false,
      promptedRoomId: null,
      storedIntent: {
        roomId: "ROOM83",
        muted: false,
      },
    } satisfies Parameters<typeof shouldOfferLiveAudioReconnect>[0];

    expect(
      shouldOfferLiveAudioReconnect({
        ...base,
        isAuthInitializing: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferLiveAudioReconnect({
        ...base,
        isRecoveringSession: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferLiveAudioReconnect({
        ...base,
        isConnecting: true,
      }),
    ).toBe(false);
    expect(
      shouldOfferLiveAudioReconnect({
        ...base,
        promptedRoomId: "ROOM83",
      }),
    ).toBe(false);
  });
});
