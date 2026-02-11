import React from "react";
import { cn } from "@/lib/utils";

type PotDropZoneProps = {
  active: boolean;
  hover: boolean;
  label: string;
  value: string;
  hint?: string | null;
  pulse?: boolean;
  testId?: string;
};

export const PotDropZone: React.FC<PotDropZoneProps> = ({
  active,
  hover,
  label,
  value,
  hint,
  pulse = false,
  testId = "pot-drop-zone",
}) => {
  return (
    <div
      className={cn(
        "pot-drop-zone",
        active && "pot-drop-zone--active",
        hover && "pot-drop-zone--hover",
      )}
      data-testid={testId}
    >
      <div className="pot-drop-zone__label">{label}</div>
      <div
        className={cn("pot-drop-zone__value", pulse && "pot-drop-zone__value--pulse")}
      >
        {value}
      </div>
      {hint ? <div className="pot-drop-zone__hint">{hint}</div> : null}
    </div>
  );
};
