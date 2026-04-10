import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { useAnchoredPopover } from "@/components/poker/use-anchored-popover";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type TrayPresetTone = "call" | "raise" | "allin";

type TrayPresetButton = {
  key: string;
  label: string;
  amount: number;
  testId: string;
  tone: TrayPresetTone;
  enabled: boolean;
};

type QuickDecisionAction = "check" | "fold";
type LegacyAction = "check" | "call" | "all-in" | "raise";
const QUICK_DECISION_SAFETY_LOCK_MS = 2000;

type TurnActionDockProps = {
  callAmount: number;
  minRaise: number;
  maxStack: number;
  trayAmount: number;
  trayInputValue: string;
  mobileChipDraftValue: string;
  showMobileChipPopover: boolean;
  isDesktopClickBetting?: boolean;
  canStartDrag: boolean;
  isDragActive: boolean;
  isYourTurn: boolean;
  canCheck: boolean;
  isAutomationMode: boolean;
  legacyRaiseAmount: number;
  trayPresetButtons: TrayPresetButton[];
  onDragStart: React.PointerEventHandler<HTMLButtonElement>;
  onDragMove: React.PointerEventHandler<HTMLButtonElement>;
  onDragEnd: React.PointerEventHandler<HTMLButtonElement>;
  onSetTrayDirectly: (amount: number) => void;
  onTrayInputChange: React.ChangeEventHandler<HTMLInputElement>;
  onTrayInputBlur: React.FocusEventHandler<HTMLInputElement>;
  onOpenMobileChipPopover: () => void;
  onCloseMobileChipPopover: () => void;
  onMobileChipDigit: (digit: string) => void;
  onMobileChipBackspace: () => void;
  onMobileChipClearDraft: () => void;
  onMobileChipConfirm: () => void;
  onClearTray: () => void;
  onSubmitTray?: () => void;
  onQuickDecisionAction: (action: QuickDecisionAction) => void;
  quickConfirmAction: QuickDecisionAction | null;
  onQuickConfirmDismiss: () => void;
  onQuickConfirmAccept: (action: QuickDecisionAction) => void;
  traySubmitLabel?: string | null;
  showTrayConfirm?: boolean;
  onTrayConfirmDismiss?: () => void;
  onTrayConfirmAccept?: () => void;
  onLegacyAction: (action: LegacyAction) => void;
  onLegacyRaiseAmountChange: (amount: number) => void;
  t: Translate;
};

export const TurnActionDock: React.FC<TurnActionDockProps> = ({
  callAmount,
  minRaise,
  maxStack,
  trayAmount,
  trayInputValue,
  mobileChipDraftValue,
  showMobileChipPopover,
  isDesktopClickBetting = false,
  canStartDrag,
  isDragActive,
  isYourTurn,
  canCheck,
  isAutomationMode,
  legacyRaiseAmount,
  trayPresetButtons,
  onDragStart,
  onDragMove,
  onDragEnd,
  onSetTrayDirectly,
  onTrayInputChange,
  onTrayInputBlur,
  onOpenMobileChipPopover,
  onCloseMobileChipPopover,
  onMobileChipDigit,
  onMobileChipBackspace,
  onMobileChipClearDraft,
  onMobileChipConfirm,
  onClearTray,
  onSubmitTray = () => {},
  onQuickDecisionAction,
  quickConfirmAction,
  onQuickConfirmDismiss,
  onQuickConfirmAccept,
  traySubmitLabel = null,
  showTrayConfirm = false,
  onTrayConfirmDismiss = () => {},
  onTrayConfirmAccept = () => {},
  onLegacyAction,
  onLegacyRaiseAmountChange,
  t,
}) => {
  const isQuickDecisionAvailable = !isAutomationMode && isYourTurn;
  const checkActionButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const foldActionButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const quickConfirmPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const traySubmitButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const trayConfirmPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const mobileChipTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const mobileChipPopoverRef = React.useRef<HTMLDivElement | null>(null);
  const latestCloseMobileChipPopoverRef = React.useRef(onCloseMobileChipPopover);
  const quickDecisionLockTimeoutRef = React.useRef<number | null>(null);
  const [isQuickDecisionTemporarilyLocked, setIsQuickDecisionTemporarilyLocked] =
    React.useState(isQuickDecisionAvailable);
  const quickConfirmAnchorRef =
    quickConfirmAction === "check" ? checkActionButtonRef : foldActionButtonRef;
  const quickConfirmStyle = useAnchoredPopover({
    isOpen: !isAutomationMode && Boolean(quickConfirmAction),
    anchorRef: quickConfirmAnchorRef,
    popoverRef: quickConfirmPopoverRef,
    preferredPlacement: "top",
    align: "start",
  });
  const trayConfirmStyle = useAnchoredPopover({
    isOpen: !isAutomationMode && showTrayConfirm,
    anchorRef: traySubmitButtonRef,
    popoverRef: trayConfirmPopoverRef,
    preferredPlacement: "top",
    align: "end",
  });
  const mobileChipPopoverStyle = useAnchoredPopover({
    isOpen: showMobileChipPopover,
    anchorRef: mobileChipTriggerRef,
    popoverRef: mobileChipPopoverRef,
    preferredPlacement: "top",
    align: "center",
  });
  const isQuickDecisionLocked = isQuickDecisionAvailable && isQuickDecisionTemporarilyLocked;
  const showDesktopSubmitTrayButton =
    !isAutomationMode && isDesktopClickBetting && Boolean(traySubmitLabel);
  const mobileChipDisplayValue = mobileChipDraftValue || "0";

  React.useLayoutEffect(() => {
    if (quickDecisionLockTimeoutRef.current !== null) {
      window.clearTimeout(quickDecisionLockTimeoutRef.current);
      quickDecisionLockTimeoutRef.current = null;
    }

    if (!isQuickDecisionAvailable) {
      setIsQuickDecisionTemporarilyLocked(false);
      return;
    }

    setIsQuickDecisionTemporarilyLocked(true);
    quickDecisionLockTimeoutRef.current = window.setTimeout(() => {
      setIsQuickDecisionTemporarilyLocked(false);
      quickDecisionLockTimeoutRef.current = null;
    }, QUICK_DECISION_SAFETY_LOCK_MS);

    return () => {
      if (quickDecisionLockTimeoutRef.current !== null) {
        window.clearTimeout(quickDecisionLockTimeoutRef.current);
        quickDecisionLockTimeoutRef.current = null;
      }
    };
  }, [isQuickDecisionAvailable]);

  React.useEffect(() => {
    latestCloseMobileChipPopoverRef.current = onCloseMobileChipPopover;
  }, [onCloseMobileChipPopover]);

  React.useEffect(() => {
    if (!showMobileChipPopover) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        mobileChipPopoverRef.current?.contains(target) ||
        mobileChipTriggerRef.current?.contains(target)
      ) {
        return;
      }

      latestCloseMobileChipPopoverRef.current();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [showMobileChipPopover]);

  return (
    <div data-testid="action-dock" className="chip-composer-dock__action-area">
      <div className="chip-composer-dock__header">
        <span className="chip-composer-dock__title">{t("game.yourTurn")}</span>
        <span className="chip-composer-dock__meta">{t("game.toCall", { amount: callAmount })}</span>
        <span className="chip-composer-dock__meta">{t("game.minRaise", { amount: minRaise })}</span>
      </div>

      <div className="chip-composer-dock__tray-row">
        <div className="chip-composer-dock__tray-panel">
          <div className="chip-composer-dock__tray-stack">
            <button
              type="button"
              onPointerDown={onDragStart}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
              onPointerCancel={onDragEnd}
              data-testid="chip-stack-draggable"
              disabled={!canStartDrag}
              className={`chip-stack chip-stack--hero ${isDragActive ? "chip-stack--dragging" : ""}`}
            >
              <span className="chip-stack__label">{t("game.tray")}</span>
              <span
                key={trayAmount}
                className="chip-stack__value chip-stack__value--animated"
                data-testid="tray-amount-value"
              >
                ${trayAmount}
              </span>
            </button>

            {showDesktopSubmitTrayButton && traySubmitLabel && (
              <button
                ref={traySubmitButtonRef}
                type="button"
                onClick={onSubmitTray}
                data-testid="action-submit-tray"
                className="chip-action chip-action--review chip-action--tray-review"
              >
                {t("game.trayReviewAction", { action: traySubmitLabel })}
              </button>
            )}
          </div>
        </div>

        <div className="chip-composer-dock__control-panel">
          <div className="chip-composer-dock__presets">
            {trayPresetButtons.map((preset) => (
              <button
                key={preset.key}
                onClick={() => onSetTrayDirectly(preset.amount)}
                className={`chip-quick chip-quick--preset chip-quick--${preset.tone}`}
                disabled={!preset.enabled}
                data-testid={preset.testId}
                data-tray-preset={preset.key}
              >
                <span>{preset.label}</span>
                <span>${preset.amount}</span>
              </button>
            ))}
          </div>

          <div className="chip-composer-dock__manual">
            {isDesktopClickBetting ? (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={trayInputValue}
                onChange={onTrayInputChange}
                onBlur={onTrayInputBlur}
                data-testid="chip-custom-input"
                aria-label={t("game.trayAmountAria")}
                className="chip-input"
              />
            ) : (
              <button
                ref={mobileChipTriggerRef}
                type="button"
                onClick={onOpenMobileChipPopover}
                data-testid="chip-mobile-input-trigger"
                aria-label={t("game.mobileChipInput.open")}
                aria-expanded={showMobileChipPopover}
                aria-haspopup="dialog"
                className="chip-mobile-input-trigger"
              >
                <span className="chip-mobile-input-trigger__label">{t("game.mobileChipInput.edit")}</span>
                <span className="chip-mobile-input-trigger__value">${trayAmount}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClearTray}
              className="chip-clear"
              disabled={!isYourTurn || trayAmount <= 0}
              data-testid="chip-clear"
            >
              {t("common.clear")}
            </button>
          </div>

          <div className="relative">
            {!isAutomationMode && quickConfirmAction && (
              <div
                ref={quickConfirmPopoverRef}
                role="dialog"
                aria-label={t("game.confirmAction.title")}
                data-testid="action-quick-confirm-popover"
                className="action-quick-confirm-popover action-quick-confirm-popover--wide"
                style={quickConfirmStyle}
              >
                <p className="text-xs font-semibold text-emerald-50">
                  {t("game.quickConfirm.prompt", {
                    action:
                      quickConfirmAction === "check"
                        ? t("common.check")
                        : t("common.fold"),
                  })}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onQuickConfirmDismiss}
                    data-testid="action-quick-confirm-cancel"
                    className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onQuickConfirmAccept(quickConfirmAction)}
                    data-testid="action-quick-confirm-accept"
                    className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </div>
            )}

            {showDesktopSubmitTrayButton && showTrayConfirm && traySubmitLabel && (
              <div
                ref={trayConfirmPopoverRef}
                role="dialog"
                aria-label={t("game.confirmAction.title")}
                data-testid="bet-action-confirm-popover"
                className="action-quick-confirm-popover action-quick-confirm-popover--wide"
                style={trayConfirmStyle}
              >
                <p className="text-xs font-semibold text-emerald-50">
                  {t("game.quickConfirm.prompt", {
                    action: traySubmitLabel,
                  })}
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={onTrayConfirmDismiss}
                    data-testid="bet-action-confirm-cancel"
                    className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={onTrayConfirmAccept}
                    data-testid="bet-action-confirm-accept"
                    className="rounded-lg bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </div>
            )}

            {!isDesktopClickBetting && showMobileChipPopover && (
              <div
                ref={mobileChipPopoverRef}
                role="dialog"
                aria-label={t("game.mobileChipInput.title")}
                data-testid="chip-mobile-input-popover"
                className="action-quick-confirm-popover chip-mobile-input-popover"
                style={mobileChipPopoverStyle}
              >
                <p className="chip-mobile-input-popover__title">{t("game.mobileChipInput.title")}</p>
                <div
                  className="chip-mobile-input-popover__display"
                  data-testid="chip-mobile-input-display"
                >
                  ${mobileChipDisplayValue}
                </div>
                <div className="chip-mobile-input-popover__keypad">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => onMobileChipDigit(digit)}
                      data-testid={`chip-mobile-digit-${digit}`}
                      className="chip-mobile-input-popover__key"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={onMobileChipBackspace}
                    data-testid="chip-mobile-backspace"
                    aria-label={t("game.mobileChipInput.backspace")}
                    className="chip-mobile-input-popover__key chip-mobile-input-popover__key--wide"
                  >
                    {t("game.mobileChipInput.backspace")}
                  </button>
                </div>
                <div className="chip-mobile-input-popover__actions">
                  <button
                    type="button"
                    onClick={onMobileChipClearDraft}
                    data-testid="chip-mobile-popover-clear"
                    className="chip-mobile-input-popover__secondary"
                  >
                    {t("common.clear")}
                  </button>
                  <button
                    type="button"
                    onClick={onCloseMobileChipPopover}
                    data-testid="chip-mobile-popover-cancel"
                    className="chip-mobile-input-popover__secondary"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    onClick={onMobileChipConfirm}
                    data-testid="chip-mobile-popover-confirm"
                    className="chip-mobile-input-popover__confirm"
                  >
                    {t("common.confirm")}
                  </button>
                </div>
              </div>
            )}

            <div className="chip-composer-dock__footer">
              {canCheck ? (
                <button
                  ref={checkActionButtonRef}
                  onClick={() => onQuickDecisionAction("check")}
                  disabled={isQuickDecisionLocked}
                  data-testid="action-check"
                  className="chip-action chip-action--check"
                >
                  {t("common.check")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onLegacyAction("call")}
                  data-testid={isAutomationMode ? "action-call-modern" : "action-call"}
                  className="chip-action chip-action--call"
                >
                  {t("game.callWithAmount", { amount: callAmount })}
                </button>
              )}
              <button
                ref={foldActionButtonRef}
                onClick={() => onQuickDecisionAction("fold")}
                disabled={isQuickDecisionLocked}
                data-testid="action-fold"
                className="chip-action chip-action--fold"
              >
                {t("common.fold")}
              </button>
            </div>
          </div>
        </div>
      </div>

      {isAutomationMode && (
        <div className="chip-composer-dock__legacy" data-testid="legacy-action-controls">
          <div className="mt-1 grid grid-cols-2 gap-2">
            {canCheck ? (
              <button
                onClick={() => onLegacyAction("check")}
                data-testid="action-check-legacy"
                className="chip-action chip-action--check"
              >
                {t("common.check")}
              </button>
            ) : (
              <button
                onClick={() => onLegacyAction("call")}
                data-testid="action-call"
                className="chip-action chip-action--call"
              >
                {t("game.callWithAmount", { amount: callAmount })}
              </button>
            )}
            <button
              onClick={() => onLegacyAction("all-in")}
              data-testid="action-all-in"
              className="chip-action chip-action--allin"
            >
              {t("game.allInWithAmount", { amount: maxStack })}
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            <input
              type="number"
              min={minRaise}
              max={maxStack}
              value={legacyRaiseAmount}
              onChange={(event) => onLegacyRaiseAmountChange(Number(event.target.value))}
              data-testid="raise-input"
              className="flex-1 rounded-xl border border-emerald-700/60 bg-emerald-950/60 px-4 py-2 text-white outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              onClick={() => onLegacyAction("raise")}
              disabled={legacyRaiseAmount < minRaise || legacyRaiseAmount > maxStack}
              data-testid="action-raise"
              className="chip-action chip-action--raise"
            >
              {t("game.raise")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
