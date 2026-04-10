import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

export type TrayPresetTone = "call" | "raise" | "allin";

export type TrayPresetButton = {
  key: string;
  label: string;
  amount: number;
  testId: string;
  tone: TrayPresetTone;
  enabled: boolean;
};

type BuildTurnActionPresetButtonsArgs = {
  callAmount: number;
  minRaise: number;
  maxStack: number;
  displayPot: number;
  isYourTurn: boolean;
  t: Translate;
};

const clampCommitToStack = (value: number, maxStack: number) =>
  Math.max(0, Math.min(maxStack, Math.round(value)));

const normalizePresetCommit = ({
  trayAmount,
  callAmount,
  minRaise,
  maxStack,
}: {
  trayAmount: number;
  callAmount: number;
  minRaise: number;
  maxStack: number;
}): number => {
  if (maxStack <= 0) {
    return 0;
  }

  const clampedAmount = clampCommitToStack(trayAmount, maxStack);
  if (clampedAmount <= 0) {
    return 0;
  }

  if (clampedAmount === maxStack) {
    return maxStack;
  }

  if (callAmount > 0) {
    if (clampedAmount <= callAmount) {
      return Math.min(callAmount, maxStack);
    }

    const minimumRaiseTotal = callAmount + Math.max(minRaise, 0);
    if (clampedAmount < minimumRaiseTotal) {
      return minimumRaiseTotal <= maxStack ? minimumRaiseTotal : maxStack;
    }

    return clampedAmount;
  }

  if (clampedAmount < minRaise) {
    return minRaise <= maxStack ? minRaise : maxStack;
  }

  return clampedAmount;
};

const isLegalPresetCommit = ({
  amount,
  callAmount,
  minRaise,
  maxStack,
  key,
}: {
  amount: number;
  callAmount: number;
  minRaise: number;
  maxStack: number;
  key: string;
}): boolean => {
  if (amount <= 0 || maxStack <= 0) {
    return false;
  }

  if (amount === maxStack) {
    return key === "all-in";
  }

  if (callAmount > 0) {
    if (amount < callAmount) {
      return false;
    }

    if (amount === callAmount) {
      return true;
    }

    return amount - callAmount >= minRaise;
  }

  return amount >= minRaise;
};

export const buildTurnActionPresetButtons = ({
  callAmount,
  minRaise,
  maxStack,
  displayPot,
  isYourTurn,
  t,
}: BuildTurnActionPresetButtonsArgs): TrayPresetButton[] => {
  const potSizedRaiseBase = callAmount > 0 ? displayPot + callAmount : displayPot;
  const potBasedCommit = (fraction: number) =>
    callAmount > 0 ? callAmount + potSizedRaiseBase * fraction : displayPot * fraction;

  const orderedPresets: Array<Omit<TrayPresetButton, "enabled">> = [
    ...(callAmount > 0
      ? [
          {
            key: "call",
            label: t("game.preset.call"),
            amount: callAmount,
            testId: "chip-load-continue",
            tone: "call" as const,
          },
        ]
      : []),
    {
      key: "min-raise",
      label: callAmount > 0 ? t("game.preset.minRaise") : t("game.preset.minBet"),
      amount: callAmount > 0 ? callAmount + minRaise : minRaise,
      testId: "chip-load-raise",
      tone: "raise",
    },
    {
      key: "third-pot",
      label: t("game.preset.thirdPot"),
      amount: potBasedCommit(1 / 3),
      testId: "preset-third-pot",
      tone: "raise",
    },
    {
      key: "half-pot",
      label: t("game.preset.halfPot"),
      amount: potBasedCommit(1 / 2),
      testId: "preset-half-pot",
      tone: "raise",
    },
    {
      key: "pot",
      label: t("game.preset.pot"),
      amount: potBasedCommit(1),
      testId: "preset-pot",
      tone: "raise",
    },
    {
      key: "all-in",
      label: t("game.preset.allIn"),
      amount: maxStack,
      testId: "chip-load-all-in",
      tone: "allin",
    },
  ];

  const seenAmounts = new Set<number>();

  return orderedPresets.flatMap((preset) => {
    const rawAmount = clampCommitToStack(preset.amount, maxStack);

    if (preset.key === "all-in") {
      if (rawAmount <= 0) {
        return [];
      }

      return [
        {
          ...preset,
          amount: rawAmount,
          enabled: isYourTurn,
        },
      ];
    }

    const normalizedAmount = normalizePresetCommit({
      trayAmount: rawAmount,
      callAmount,
      minRaise,
      maxStack,
    });
    const isLegal =
      normalizedAmount > 0 &&
      normalizedAmount < maxStack &&
      isLegalPresetCommit({
        amount: normalizedAmount,
        callAmount,
        minRaise,
        maxStack,
        key: preset.key,
      });

    if (!isLegal || seenAmounts.has(normalizedAmount)) {
      return [];
    }

    seenAmounts.add(normalizedAmount);
    return [
      {
        ...preset,
        amount: normalizedAmount,
        enabled: isYourTurn,
      },
    ];
  });
};
