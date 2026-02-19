import { useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, RefObject } from "react";

type Placement = "top" | "bottom";
type Align = "start" | "center" | "end";

type UseAnchoredPopoverParams = {
  isOpen: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  popoverRef: RefObject<HTMLElement | null>;
  preferredPlacement?: Placement;
  align?: Align;
  offset?: number;
  viewportPadding?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const useAnchoredPopover = ({
  isOpen,
  anchorRef,
  popoverRef,
  preferredPlacement = "top",
  align = "end",
  offset = 8,
  viewportPadding = 8,
}: UseAnchoredPopoverParams): CSSProperties => {
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: -9999,
    top: -9999,
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const computePosition = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) {
        return;
      }

      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;

      const minLeft = viewportLeft + viewportPadding;
      const minTop = viewportTop + viewportPadding;
      const maxLeft = viewportLeft + viewportWidth - viewportPadding;
      const maxTop = viewportTop + viewportHeight - viewportPadding;

      const anchorRect = anchor.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();

      const alignStart = anchorRect.left;
      const alignCenter = anchorRect.left + (anchorRect.width - popoverRect.width) / 2;
      const alignEnd = anchorRect.right - popoverRect.width;
      const rawLeft = align === "start" ? alignStart : align === "center" ? alignCenter : alignEnd;

      const topCandidate = anchorRect.top - popoverRect.height - offset;
      const bottomCandidate = anchorRect.bottom + offset;
      const topFits = topCandidate >= minTop;
      const bottomFits = bottomCandidate + popoverRect.height <= maxTop;
      const useBottom =
        preferredPlacement === "bottom" ? !bottomFits && topFits : !topFits && bottomFits;
      const rawTop = useBottom ? bottomCandidate : topCandidate;

      const clampedLeft = clamp(rawLeft, minLeft, Math.max(minLeft, maxLeft - popoverRect.width));
      const clampedTop = clamp(rawTop, minTop, Math.max(minTop, maxTop - popoverRect.height));

      setPosition({
        left: Math.round(clampedLeft),
        top: Math.round(clampedTop),
      });
    };

    computePosition();
    window.addEventListener("resize", computePosition);
    window.addEventListener("scroll", computePosition, true);
    window.visualViewport?.addEventListener("resize", computePosition);
    window.visualViewport?.addEventListener("scroll", computePosition);

    return () => {
      window.removeEventListener("resize", computePosition);
      window.removeEventListener("scroll", computePosition, true);
      window.visualViewport?.removeEventListener("resize", computePosition);
      window.visualViewport?.removeEventListener("scroll", computePosition);
    };
  }, [
    align,
    anchorRef,
    isOpen,
    offset,
    popoverRef,
    preferredPlacement,
    viewportPadding,
  ]);

  return useMemo(
    () => ({
      left: `${position.left}px`,
      top: `${position.top}px`,
      position: "fixed" as const,
      zIndex: 75,
    }),
    [position.left, position.top],
  );
};
