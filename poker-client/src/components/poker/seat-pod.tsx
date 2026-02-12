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
  readyOverlayTone?: "ready" | "pending";
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
  readyOverlayTone = "pending",
}) => {
  const shouldRenderStatusInActionRow =
    seatState === "folded" && Boolean(internalStatusLabel);

  return (
    <div
      data-testid={testId}
      className={cn(
        "seat-pod",
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
          className={cn(
            "seat-pod__ready-overlay",
            readyOverlayTone === "ready"
              ? "seat-pod__ready-overlay--ready"
              : "seat-pod__ready-overlay--pending",
          )}
          data-testid={`${testId}-ready-overlay`}
          data-ready-state={readyOverlayTone}
        >
          {readyOverlayLabel}
        </div>
      )}

      {externalStatusLabel && (
        <div
          className={`seat-pod__status-badge seat-pod__status-badge--external ${externalStatusToneClass}`}
          data-testid={`${testId}-external-status`}
          data-seat-status={externalStatusLabel}
        >
          {externalStatusLabel}
        </div>
      )}

      <div className="seat-pod__row">
        <span className="seat-pod__emoji" aria-hidden="true">
          {playerEmoji}
        </span>
        <span className="seat-pod__name">{playerName}</span>

        {internalStatusLabel && !shouldRenderStatusInActionRow && (
          <span
            className={`seat-pod__status-badge ${internalStatusToneClass}`}
            data-testid={`${testId}-status`}
            data-seat-status={internalStatusLabel}
          >
            {internalStatusLabel}
          </span>
        )}
      </div>

      <div className="seat-pod__row seat-pod__row--action">
        {shouldRenderStatusInActionRow ? (
          <span
            className={cn(
              "seat-pod__status-badge",
              "seat-pod__status-badge--inline-action",
              internalStatusToneClass,
            )}
            data-testid={`${testId}-status`}
            data-seat-status={internalStatusLabel}
          >
            {internalStatusLabel}
          </span>
        ) : (
          <div
            className={cn(
              "seat-pod__action",
              actionLabel ? `seat-pod__action--${actionLabel.tone}` : "",
            )}
            data-testid={`${testId}-action`}
          >
            {actionLabel?.text ?? ""}
          </div>
        )}
      </div>

      <div className="seat-pod__row seat-pod__row--remaining">
        <div className="seat-pod__remaining" data-testid={`${testId}-remaining`}>
          {remainingLabel}
        </div>
      </div>
    </div>
  );
};
