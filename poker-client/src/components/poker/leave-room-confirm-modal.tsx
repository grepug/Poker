import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { PokerModalPanel, PokerModalShell } from "./modal-shell";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type LeaveRoomConfirmModalProps = {
  canConfirm?: boolean;
  body?: string;
  warning?: string;
  availabilityReason?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  t: Translate;
};

export const LeaveRoomConfirmModal: React.FC<LeaveRoomConfirmModalProps> = ({
  canConfirm = true,
  body,
  warning,
  availabilityReason = null,
  onCancel,
  onConfirm,
  t,
}) => {
  const titleId = React.useId();

  return (
    <PokerModalShell
      layout="centered"
      testId="leave-room-confirm-modal"
      zIndexClassName="z-[80]"
    >
      <PokerModalPanel
        className="max-w-md p-5"
        ariaLabelledBy={titleId}
      >
        <h3 id={titleId} className="text-lg font-black text-white">
          {t("game.leaveConfirm.title")}
        </h3>
        <p className="mt-2 text-sm text-emerald-100/85">
          {body ?? t("game.leaveConfirm.body")}
        </p>
        <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100">
          {warning ?? t("game.leaveConfirm.warning")}
        </p>
        {availabilityReason && (
          <p
            className="mt-3 rounded-lg border border-rose-400/60 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100"
            data-testid="leave-room-confirm-availability-reason"
          >
            {availabilityReason}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            data-testid="leave-room-confirm-cancel"
            className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="leave-room-confirm-accept"
            className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:bg-rose-900/40 disabled:text-rose-100/70"
          >
            {t("game.leaveConfirm.confirm")}
          </button>
        </div>
      </PokerModalPanel>
    </PokerModalShell>
  );
};
