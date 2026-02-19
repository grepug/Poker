import React from "react";
import { cn } from "@/lib/utils";

type TableShellProps = {
  children: React.ReactNode;
  showDesktopTurnDock: boolean;
  isChatPanelOpen: boolean;
};

export const TableShell: React.FC<TableShellProps> = ({
  children,
  showDesktopTurnDock,
  isChatPanelOpen,
}) => {
  return (
    <main
      className={cn(
        "table-shell",
        showDesktopTurnDock && "table-shell--desktop-turn-dock",
        isChatPanelOpen && "table-shell--chat-open",
      )}
    >
      {children}
    </main>
  );
};
