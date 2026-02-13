import React from "react";
import { cn } from "@/lib/utils";

type SeatState =
  | "turn"
  | "disconnected"
  | "all-in"
  | "folded"
  | "waiting"
  | "default";

type SeatActionLabel = {
  text: string;
  tone: "blind" | "aggressive" | "call" | "allin" | "pending";
};

type SeatPodProps = {
  testId: string;
  playerEmoji: string;
  playerName: string;
  isYou: boolean;
  roleIcon: "dealer" | "small-blind" | null;
  roleLabel: string | null;
  externalStatusLabel: string | null;
  externalStatusToneClass: string;
  internalStatusLabel: string | null;
  internalStatusToneClass: string;
  actionLabel: SeatActionLabel | null;
  remainingLabel: string;
  seatState: SeatState;
  densityClass: string;
  readyOverlayLabel?: string | null;
};

export const SeatPod: React.FC<SeatPodProps> = ({
  testId,
  playerEmoji,
  playerName,
  isYou,
  roleIcon,
  roleLabel,
  externalStatusLabel,
  externalStatusToneClass,
  internalStatusLabel,
  internalStatusToneClass,
  actionLabel,
  remainingLabel,
  seatState,
  densityClass,
  readyOverlayLabel,
}) => {
  const floatingStatusLabel = externalStatusLabel ?? internalStatusLabel;
  const floatingStatusToneClass = externalStatusLabel
    ? externalStatusToneClass
    : internalStatusToneClass;
  const floatingStatusTestId = externalStatusLabel
    ? `${testId}-external-status`
    : `${testId}-status`;

  return (
    <div
      data-testid={testId}
      className={cn(
        "seat-pod",
        isYou && "seat-pod--you",
        Boolean(roleIcon && roleLabel) && "seat-pod--has-role-icon",
        Boolean(floatingStatusLabel) && "seat-pod--has-status-badge",
        seatState === "turn" && "seat-pod--turn",
        seatState === "all-in" && "seat-pod--allin",
        seatState === "disconnected" && "seat-pod--disconnected",
        seatState === "folded" && "seat-pod--folded",
        seatState === "waiting" && "seat-pod--waiting",
        densityClass,
      )}
    >
      {isYou && (
        <div className="seat-pod__you-indicator" data-testid={`${testId}-you-indicator`}>
          ★
        </div>
      )}

      {roleIcon && roleLabel && (
        <div
          className={`seat-pod__role-icon seat-pod__role-icon--${roleIcon}`}
          data-testid={`${testId}-${roleIcon}-icon`}
        >
          {roleLabel}
        </div>
      )}

      {readyOverlayLabel && (
        <div
          className="seat-pod__ready-overlay seat-pod__ready-overlay--ready"
          data-testid={`${testId}-ready-overlay`}
          data-ready-state="ready"
        >
          {readyOverlayLabel}
        </div>
      )}

      {floatingStatusLabel && (
        <div
          className={cn(
            "seat-pod__status-badge",
            "seat-pod__status-badge--external",
            floatingStatusToneClass,
          )}
          data-testid={floatingStatusTestId}
          data-seat-status={floatingStatusLabel}
        >
          {floatingStatusLabel}
        </div>
      )}

      <div className="seat-pod__row seat-pod__row--identity">
        <span className="seat-pod__emoji" aria-hidden="true">
          {playerEmoji}
        </span>
        <span className="seat-pod__name">{playerName}</span>
      </div>

      <div className="seat-pod__row seat-pod__row--action">
        <div
          className={cn(
            "seat-pod__action",
            actionLabel ? `seat-pod__action--${actionLabel.tone}` : "",
          )}
          data-testid={`${testId}-action`}
        >
          {actionLabel?.text ?? ""}
        </div>
      </div>

      <div className="seat-pod__row seat-pod__row--remaining">
        <div className="seat-pod__remaining" data-testid={`${testId}-remaining`}>
          {remainingLabel}
        </div>
      </div>
    </div>
  );
};
