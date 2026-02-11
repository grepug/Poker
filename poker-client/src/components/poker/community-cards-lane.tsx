import React from "react";
import { cn } from "@/lib/utils";

type CommunityCardsLaneProps = {
  children: React.ReactNode;
  className?: string;
  testId?: string;
};

export const CommunityCardsLane: React.FC<CommunityCardsLaneProps> = ({
  children,
  className,
  testId = "community-cards",
}) => {
  return (
    <div className={cn("community-lane", className)} data-testid={testId}>
      {children}
    </div>
  );
};
