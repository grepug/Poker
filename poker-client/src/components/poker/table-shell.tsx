import React from "react";
import { cn } from "@/lib/utils";

type TableShellProps = {
  children: React.ReactNode;
  isDesktopTwoColumn?: boolean;
  showDesktopTurnDock: boolean;
  showDesktopOperationDock: boolean;
  desktopBottomBarHeight: number;
  mobileBottomSafeHeight: number;
  isChatPanelOpen: boolean;
};

export const TableShell: React.FC<TableShellProps> = ({
  children,
  isDesktopTwoColumn = false,
  showDesktopTurnDock,
  showDesktopOperationDock,
  desktopBottomBarHeight,
  mobileBottomSafeHeight,
  isChatPanelOpen,
}) => {
  return (
    <main
      style={
        {
          "--desktop-active-bottom-bar-height": `${Math.max(0, desktopBottomBarHeight)}px`,
          "--mobile-bottom-safe-height": `${Math.max(0, mobileBottomSafeHeight)}px`,
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
