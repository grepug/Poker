import React, { useCallback, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type SeatState =
  | "turn"
  | "disconnected"
  | "all-in"
  | "folded"
  | "waiting"
  | "default";

type SeatActionLabel = {
  text: string;
  tone: "blind" | "aggressive" | "call" | "allin" | "pending";
};

type SeatPodProps = {
  testId: string;
  playerEmoji: string;
  playerName: string;
  isYou: boolean;
  roleIcon: "dealer" | "small-blind" | null;
  roleLabel: string | null;
  externalStatusLabel: string | null;
  externalStatusToneClass: string;
  internalStatusLabel: string | null;
  internalStatusToneClass: string;
  actionLabel: SeatActionLabel | null;
  remainingLabel: string;
  seatState: SeatState;
  densityClass: string;
  readyOverlayLabel?: string | null;
};

type AutoFitTextRule = {
  selector: string;
  minFontPx: number;
};

const AUTO_FIT_TEXT_RULES: AutoFitTextRule[] = [
  { selector: ".seat-pod__status-badge", minFontPx: 6.5 },
  { selector: ".seat-pod__action", minFontPx: 7 },
  { selector: ".seat-pod__remaining", minFontPx: 7.5 },
  { selector: ".seat-pod__ready-overlay", minFontPx: 6.5 },
  { selector: ".seat-pod__role-icon", minFontPx: 5.7 },
];

const AUTO_FIT_TOLERANCE_PX = 0.5;
const AUTO_FIT_STEPS = 12;
const SEAT_POD_BASE_ASPECT_RATIO = 1.26;
const ACTION_WRAP_HEIGHT_PADDING_PX = 4;

const hasTextOverflow = (node: HTMLElement) =>
  node.scrollWidth > node.clientWidth + AUTO_FIT_TOLERANCE_PX ||
  node.scrollHeight > node.clientHeight + AUTO_FIT_TOLERANCE_PX;

const resetSeatTextFontSizes = (seatNode: HTMLElement) => {
  AUTO_FIT_TEXT_RULES.forEach(({ selector }) => {
    seatNode.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      node.style.fontSize = "";
    });
  });
};

const seatHasTextOverflow = (seatNode: HTMLElement) =>
  AUTO_FIT_TEXT_RULES.some(({ selector }) =>
    Array.from(seatNode.querySelectorAll<HTMLElement>(selector)).some((node) => {
      const text = (node.textContent || "").trim();
      return Boolean(text) && hasTextOverflow(node);
    }),
  );

const fitSingleLineTextNode = (node: HTMLElement, minFontPx: number) => {
  const text = (node.textContent || "").trim();
  if (!text) {
    return;
  }

  node.style.fontSize = "";
  const computedStyle = window.getComputedStyle(node);
  const baseFontPx = Number.parseFloat(computedStyle.fontSize || "");

  if (!Number.isFinite(baseFontPx) || baseFontPx <= 0) {
    return;
  }

  const lowerBound = Math.min(minFontPx, baseFontPx);
  node.style.fontSize = `${baseFontPx}px`;

  if (!hasTextOverflow(node)) {
    return;
  }

  node.style.fontSize = `${lowerBound}px`;
  if (hasTextOverflow(node)) {
    return;
  }

  let low = lowerBound;
  let high = baseFontPx;
  let best = lowerBound;

  for (let step = 0; step < AUTO_FIT_STEPS; step += 1) {
    const mid = (low + high) / 2;
    node.style.fontSize = `${mid}px`;

    if (hasTextOverflow(node)) {
      high = mid;
      continue;
    }

    best = mid;
    low = mid;
  }

  node.style.fontSize = `${best}px`;
};

const fitSeatTextWithinMinFonts = (seatNode: HTMLElement) => {
  AUTO_FIT_TEXT_RULES.forEach(({ selector, minFontPx }) => {
    seatNode.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      fitSingleLineTextNode(node, minFontPx);
    });
  });
};

const parseLineHeightPx = (node: HTMLElement) => {
  const computedStyle = window.getComputedStyle(node);
  const fontSizePx = Number.parseFloat(computedStyle.fontSize || "0");
  const lineHeightRaw = computedStyle.lineHeight;
  if (lineHeightRaw.endsWith("px")) {
    const parsedLineHeight = Number.parseFloat(lineHeightRaw);
    if (Number.isFinite(parsedLineHeight) && parsedLineHeight > 0) {
      return parsedLineHeight;
    }
  }

  return fontSizePx > 0 ? fontSizePx * 1.14 : 0;
};

const resolveRenderedTextLineCount = (node: HTMLElement) => {
  const text = (node.textContent || "").trim();
  if (!text) {
    return 1;
  }

  const range = document.createRange();
  range.selectNodeContents(node);
  const rawRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > AUTO_FIT_TOLERANCE_PX && rect.height > AUTO_FIT_TOLERANCE_PX,
  );
  range.detach?.();

  if (rawRects.length === 0) {
    return 1;
  }

  const distinctLineTops = new Set(
    rawRects.map((rect) => Math.round(rect.top * 2) / 2),
  );
  return Math.max(1, distinctLineTops.size);
};

const resolveActionLineCount = (seatNode: HTMLElement) => {
  const actionNode = seatNode.querySelector<HTMLElement>(".seat-pod__action");
  if (!actionNode) {
    return 1;
  }

  const text = (actionNode.textContent || "").trim();
  if (!text) {
    return 1;
  }

  return resolveRenderedTextLineCount(actionNode);
};

const applyAdaptiveSeatHeight = (seatNode: HTMLElement) => {
  const actionLineCount = resolveActionLineCount(seatNode);
  if (actionLineCount <= 1) {
    seatNode.classList.remove("seat-pod--action-wrapped");
    seatNode.style.removeProperty("min-height");
    seatNode.dataset.actionLines = "1";
    return;
  }

  const actionNode = seatNode.querySelector<HTMLElement>(".seat-pod__action");
  if (!actionNode) {
    seatNode.classList.remove("seat-pod--action-wrapped");
    seatNode.style.removeProperty("min-height");
    return;
  }

  const lineHeightPx = parseLineHeightPx(actionNode);
  const seatWidthPx = seatNode.getBoundingClientRect().width;
  const baseHeightPx = seatWidthPx > 0 ? seatWidthPx / SEAT_POD_BASE_ASPECT_RATIO : 0;
  const wrappedExtraHeightPx = Math.max(
    0,
    (actionLineCount - 1) * lineHeightPx + ACTION_WRAP_HEIGHT_PADDING_PX,
  );
  const targetMinHeightPx = baseHeightPx + wrappedExtraHeightPx;

  seatNode.classList.add("seat-pod--action-wrapped");
  seatNode.style.minHeight = `${targetMinHeightPx.toFixed(2)}px`;
  seatNode.dataset.actionLines = String(actionLineCount);
};

const autoFitSeatText = (seatNode: HTMLElement) => {
  resetSeatTextFontSizes(seatNode);
  if (seatHasTextOverflow(seatNode)) {
    fitSeatTextWithinMinFonts(seatNode);
  }
  applyAdaptiveSeatHeight(seatNode);
};

export const SeatPod: React.FC<SeatPodProps> = ({
  testId,
  playerEmoji,
  playerName,
  isYou,
  roleIcon,
  roleLabel,
  externalStatusLabel,
  externalStatusToneClass,
  internalStatusLabel,
  internalStatusToneClass,
  actionLabel,
  remainingLabel,
  seatState,
  densityClass,
  readyOverlayLabel,
}) => {
  const floatingStatusLabel = externalStatusLabel ?? internalStatusLabel;
  const floatingStatusToneClass = externalStatusLabel
    ? externalStatusToneClass
    : internalStatusToneClass;
  const floatingStatusTestId = externalStatusLabel
    ? `${testId}-external-status`
    : `${testId}-status`;
  const seatNodeRef = useRef<HTMLDivElement | null>(null);
  const rafIdRef = useRef(0);

  const scheduleFit = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    const seatNode = seatNodeRef.current;
    if (!seatNode) {
      return;
    }

    if (rafIdRef.current) {
      window.cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = 0;
      autoFitSeatText(seatNode);
    });
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const seatNode = seatNodeRef.current;
    if (!seatNode) {
      return;
    }

    scheduleFit();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleFit) : null;
    resizeObserver?.observe(seatNode);

    const mutationObserver = new MutationObserver(scheduleFit);
    mutationObserver.observe(seatNode, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    window.addEventListener("resize", scheduleFit);

    return () => {
      if (rafIdRef.current) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleFit);
    };
  }, [scheduleFit]);

  useLayoutEffect(() => {
    scheduleFit();
  }, [
    scheduleFit,
    actionLabel?.text,
    densityClass,
    floatingStatusLabel,
    playerName,
    readyOverlayLabel,
    remainingLabel,
    roleLabel,
  ]);

  return (
    <div
      ref={seatNodeRef}
      data-testid={testId}
      className={cn(
        "seat-pod",
        isYou && "seat-pod--you",
        Boolean(roleIcon && roleLabel) && "seat-pod--has-role-icon",
        Boolean(floatingStatusLabel) && "seat-pod--has-status-badge",
        seatState === "turn" && "seat-pod--turn",
        seatState === "all-in" && "seat-pod--allin",
        seatState === "disconnected" && "seat-pod--disconnected",
        seatState === "folded" && "seat-pod--folded",
        seatState === "waiting" && "seat-pod--waiting",
        densityClass,
      )}
    >
      {roleIcon && roleLabel && (
        <div
          className={`seat-pod__role-icon seat-pod__role-icon--${roleIcon}`}
          data-testid={`${testId}-${roleIcon}-icon`}
        >
          {roleLabel}
        </div>
      )}

      {readyOverlayLabel && (
        <div
          className="seat-pod__ready-overlay seat-pod__ready-overlay--ready"
          data-testid={`${testId}-ready-overlay`}
          data-ready-state="ready"
        >
          {readyOverlayLabel}
        </div>
      )}

      {floatingStatusLabel && (
        <div
          className={cn(
            "seat-pod__status-badge",
            "seat-pod__status-badge--external",
            floatingStatusToneClass,
          )}
          data-testid={floatingStatusTestId}
          data-seat-status={floatingStatusLabel}
        >
          {floatingStatusLabel}
        </div>
      )}

      <div className="seat-pod__row seat-pod__row--identity">
        {isYou && (
          <span className="seat-pod__you-indicator" data-testid={`${testId}-you-indicator`}>
            ★
          </span>
        )}
        <span className="seat-pod__emoji" aria-hidden="true">
          {playerEmoji}
        </span>
        <span className="seat-pod__name">{playerName}</span>
      </div>

      <div className="seat-pod__row seat-pod__row--action">
        <div
          className={cn(
            "seat-pod__action",
            actionLabel ? `seat-pod__action--${actionLabel.tone}` : "",
          )}
          data-testid={`${testId}-action`}
        >
          {actionLabel?.text ?? ""}
        </div>
      </div>

      <div className="seat-pod__row seat-pod__row--remaining">
        <div className="seat-pod__remaining" data-testid={`${testId}-remaining`}>
          {remainingLabel}
        </div>
      </div>
    </div>
  );
};
