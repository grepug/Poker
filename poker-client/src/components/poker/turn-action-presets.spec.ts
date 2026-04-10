import { describe, expect, it } from "vitest";
import { buildTurnActionPresetButtons } from "./turn-action-presets";

const t = (key: string) => key;

describe("buildTurnActionPresetButtons", () => {
  it("builds the expanded preset row in the requested order when facing a bet", () => {
    const presets = buildTurnActionPresetButtons({
      callAmount: 40,
      minRaise: 80,
      maxStack: 980,
      displayPot: 360,
      isYourTurn: true,
      t,
    });

    expect(presets.map((preset) => preset.key)).toEqual([
      "call",
      "min-raise",
      "third-pot",
      "half-pot",
      "pot",
      "all-in",
    ]);

    expect(presets.map((preset) => preset.amount)).toEqual([40, 120, 173, 240, 440, 980]);
    expect(presets.every((preset) => preset.enabled)).toBe(true);
  });

  it("omits call but keeps the pot-size presets when no call is facing the player", () => {
    const presets = buildTurnActionPresetButtons({
      callAmount: 0,
      minRaise: 80,
      maxStack: 980,
      displayPot: 360,
      isYourTurn: true,
      t,
    });

    expect(presets.map((preset) => preset.key)).toEqual([
      "min-raise",
      "third-pot",
      "half-pot",
      "pot",
      "all-in",
    ]);

    expect(presets.map((preset) => preset.amount)).toEqual([80, 120, 180, 360, 980]);
  });

  it("hides pot-size buttons that are illegal and keeps the remaining legal order", () => {
    const presets = buildTurnActionPresetButtons({
      callAmount: 40,
      minRaise: 80,
      maxStack: 200,
      displayPot: 120,
      isYourTurn: true,
      t,
    });

    expect(presets.map((preset) => preset.key)).toEqual([
      "call",
      "min-raise",
      "all-in",
    ]);

    expect(presets.map((preset) => preset.amount)).toEqual([40, 120, 200]);
  });

  it("treats pot-sized raises as calling first, then raising the pot-after-call", () => {
    const presets = buildTurnActionPresetButtons({
      callAmount: 20,
      minRaise: 10,
      maxStack: 1000,
      displayPot: 60,
      isYourTurn: true,
      t,
    });

    expect(presets.find((preset) => preset.key === "pot")?.amount).toBe(100);
    expect(presets.find((preset) => preset.key === "half-pot")?.amount).toBe(60);
    expect(presets.find((preset) => preset.key === "third-pot")?.amount).toBe(47);
  });
});
