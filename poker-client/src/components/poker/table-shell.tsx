import React from "react";
import { cn } from "@/lib/utils";

type TableShellProps = {
  children: React.ReactNode;
  isDesktopTwoColumn?: boolean;
  showDesktopTurnDock: boolean;
  showDesktopOperationDock: boolean;
  desktopBottomBarHeight: number;
  isChatPanelOpen: boolean;
};

export const TableShell: React.FC<TableShellProps> = ({
  children,
  isDesktopTwoColumn = false,
  showDesktopTurnDock,
  showDesktopOperationDock,
  desktopBottomBarHeight,
  isChatPanelOpen,
}) => {
  return (
    <main
      style={
        {
          "--desktop-active-bottom-bar-height": `${Math.max(0, desktopBottomBarHeight)}px`,
        } as React.CSSProperties
      }
      className={cn(
        "table-shell",
        isDesktopTwoColumn && "table-shell--desktop-two-column",
        showDesktopTurnDock && "table-shell--desktop-turn-dock",
        showDesktopOperationDock && "table-shell--desktop-operation-dock",
        isChatPanelOpen && "table-shell--chat-open",
      )}
    >
      {children}
    </main>
  );
};
