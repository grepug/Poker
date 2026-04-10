import React from "react";
import { cn } from "@/lib/utils";

type TurnCenterAlertProps = {
  eyebrow: string;
  title: string;
  testId?: string;
  anchorToStage?: boolean;
};

export const TurnCenterAlert: React.FC<TurnCenterAlertProps> = ({
  eyebrow,
  title,
  testId = "turn-center-alert",
  anchorToStage = false,
}) => {
  return (
    <div
      className={cn(
        "turn-center-alert-layer",
        anchorToStage && "turn-center-alert-layer--table-stage",
      )}
    >
      <div
        className={cn(
          "turn-center-alert",
          anchorToStage && "turn-center-alert--table-stage",
        )}
        data-testid={testId}
      >
        <span className="turn-center-alert__eyebrow">{eyebrow}</span>
        <span className="turn-center-alert__title">{title}</span>
      </div>
    </div>
  );
};
