import React from "react";
import { cn } from "@/lib/utils";

type TableShellProps = {
  children: React.ReactNode;
  isYourTurn: boolean;
  isDesktopSideDock: boolean;
  isChatPanelOpen: boolean;
};

export const TableShell: React.FC<TableShellProps> = ({
  children,
  isYourTurn,
  isDesktopSideDock,
  isChatPanelOpen,
}) => {
  return (
    <main
      className={cn(
        "table-shell",
        isYourTurn && isDesktopSideDock && "table-shell--desktop-turn-dock",
        isChatPanelOpen && "table-shell--chat-open",
      )}
    >
      {children}
    </main>
  );
};
