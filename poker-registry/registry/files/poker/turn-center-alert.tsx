import React from "react";

type TurnCenterAlertProps = {
  eyebrow: string;
  title: string;
  testId?: string;
};

export const TurnCenterAlert: React.FC<TurnCenterAlertProps> = ({
  eyebrow,
  title,
  testId = "turn-center-alert",
}) => {
  return (
    <div className="turn-center-alert-layer">
      <div className="turn-center-alert" data-testid={testId}>
        <span className="turn-center-alert__eyebrow">{eyebrow}</span>
        <span className="turn-center-alert__title">{title}</span>
      </div>
    </div>
  );
};
