import React from "react";
import { cn } from "@/lib/utils";

type ActionCenterAlertProps = {
  eyebrow: string;
  actor: string;
  title: string;
  tone: "neutral" | "aggressive" | "fold" | "allin";
  exiting: boolean;
  testId?: string;
  wrapInLayer?: boolean;
  cardClassName?: string;
};

export const ActionCenterAlert: React.FC<ActionCenterAlertProps> = ({
  eyebrow,
  actor,
  title,
  tone,
  exiting,
  testId = "action-center-alert",
  wrapInLayer = true,
  cardClassName,
}) => {
  const alertCard = (
    <div
      className={cn(
        "action-center-alert",
        `action-center-alert--${tone}`,
        exiting && "action-center-alert--exit",
        cardClassName,
      )}
      data-testid={testId}
    >
      <span className="action-center-alert__eyebrow">{eyebrow}</span>
      <span className="action-center-alert__actor">{actor}</span>
      <span className="action-center-alert__title">{title}</span>
    </div>
  );

  if (!wrapInLayer) {
    return alertCard;
  }

  return (
    <div className="action-center-alert-layer" data-testid={`${testId}-layer`}>
      {alertCard}
    </div>
  );
};
