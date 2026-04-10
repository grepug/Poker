import React from "react";
import { ActionCenterAlert } from "@/components/poker/action-center-alert";

type ActionPointerVector = {
  x: number;
  y: number;
  angle: number;
  length: number;
};

type ActionCenterAlertOverlayProps = {
  pointerVector: ActionPointerVector | null;
  eyebrow: string;
  actor: string;
  title: string;
  tone: "neutral" | "aggressive" | "fold" | "allin";
  exiting: boolean;
  cardRef: React.RefObject<HTMLDivElement | null>;
};

export const ActionCenterAlertOverlay: React.FC<ActionCenterAlertOverlayProps> = ({
  pointerVector,
  eyebrow,
  actor,
  title,
  tone,
  exiting,
  cardRef,
}) => {
  return (
    <div
      className="action-center-alert-layer action-center-alert-layer--table-stage"
      aria-live="polite"
      data-testid="action-center-alert"
    >
      {pointerVector && (
        <div
          className="action-center-alert__arrow action-center-alert__arrow--table-stage"
          style={{
            left: `${pointerVector.x}px`,
            top: `${pointerVector.y}px`,
            width: `${pointerVector.length}px`,
            transform: `translateY(-50%) rotate(${pointerVector.angle}deg)`,
          }}
        >
          <span className="action-center-alert__arrow-head" />
        </div>
      )}
      <div ref={cardRef}>
        <ActionCenterAlert
          eyebrow={eyebrow}
          actor={actor}
          title={title}
          tone={tone}
          exiting={exiting}
          testId="action-center-alert-card"
          wrapInLayer={false}
          cardClassName="action-center-alert--table-stage"
        />
      </div>
    </div>
  );
};
