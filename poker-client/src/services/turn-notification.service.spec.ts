import { afterEach, describe, expect, it, vi } from "vitest";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  preload = "";
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });

  constructor(src = "") {
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

describe("turn-notification service", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    FakeAudio.instances = [];
    Reflect.deleteProperty(globalThis, "Audio");
  });

  it("attempts the bundled turn notification cue from the start when playing", async () => {
    vi.stubGlobal("Audio", FakeAudio);
    const { TURN_NOTIFICATION_AUDIO_PATH, playTurnNotification } = await import(
      "./turn-notification.service"
    );

    await playTurnNotification();

    const audioInstance = FakeAudio.instances[0];
    expect(audioInstance.src).toBe(TURN_NOTIFICATION_AUDIO_PATH);
    expect(audioInstance.preload).toBe("auto");
    expect(audioInstance.pause).toHaveBeenCalledTimes(1);
    expect(audioInstance.currentTime).toBe(0);
    expect(audioInstance.play).toHaveBeenCalledTimes(1);
  });

  it("swallows blocked playback failures without throwing", async () => {
    const playbackBlocked = new Error("Playback blocked");
    class BlockedAudio extends FakeAudio {
      play = vi.fn(async () => {
        throw playbackBlocked;
      });
    }

    vi.stubGlobal("Audio", BlockedAudio);
    const { playTurnNotification } = await import("./turn-notification.service");

    await expect(playTurnNotification()).resolves.toBeUndefined();
  });

  it("plays on initial actionable state and false-to-true turn transitions only", async () => {
    const { shouldPlayTurnNotification } = await import(
      "./turn-notification.service"
    );

    expect(shouldPlayTurnNotification(null, true)).toBe(true);
    expect(shouldPlayTurnNotification(null, false)).toBe(false);
    expect(shouldPlayTurnNotification(false, true)).toBe(true);
    expect(shouldPlayTurnNotification(true, true)).toBe(false);
    expect(shouldPlayTurnNotification(true, false)).toBe(false);
    expect(shouldPlayTurnNotification(false, false)).toBe(false);
  });

  it("fires exactly once across stable rerenders and replays only after turn leaves and returns", async () => {
    const { applyTurnNotificationTransition } = await import(
      "./turn-notification.service"
    );
    const onTurnStart = vi.fn();

    let previousIsYourTurn = applyTurnNotificationTransition({
      previousIsYourTurn: null,
      isYourTurn: true,
      onTurnStart,
    });
    expect(onTurnStart).toHaveBeenCalledTimes(1);

    previousIsYourTurn = applyTurnNotificationTransition({
      previousIsYourTurn,
      isYourTurn: true,
      onTurnStart,
    });
    expect(onTurnStart).toHaveBeenCalledTimes(1);

    previousIsYourTurn = applyTurnNotificationTransition({
      previousIsYourTurn,
      isYourTurn: false,
      onTurnStart,
    });
    expect(onTurnStart).toHaveBeenCalledTimes(1);

    previousIsYourTurn = applyTurnNotificationTransition({
      previousIsYourTurn,
      isYourTurn: false,
      onTurnStart,
    });
    expect(onTurnStart).toHaveBeenCalledTimes(1);

    previousIsYourTurn = applyTurnNotificationTransition({
      previousIsYourTurn,
      isYourTurn: true,
      onTurnStart,
    });
    expect(previousIsYourTurn).toBe(true);
    expect(onTurnStart).toHaveBeenCalledTimes(2);
  });
});
