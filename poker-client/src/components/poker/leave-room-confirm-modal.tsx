import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type LeaveRoomConfirmModalProps = {
  onCancel: () => void;
  onConfirm: () => void;
  t: Translate;
};

export const LeaveRoomConfirmModal: React.FC<LeaveRoomConfirmModalProps> = ({
  onCancel,
  onConfirm,
  t,
}) => (
  <div
    className="fixed inset-0 z-[80] flex items-center justify-center bg-emerald-950/88 p-4 backdrop-blur-sm"
    data-testid="leave-room-confirm-modal"
  >
    <div className="surface-panel w-full max-w-md p-5" role="dialog" aria-modal="true">
      <h3 className="text-lg font-black text-white">{t("game.leaveConfirm.title")}</h3>
      <p className="mt-2 text-sm text-emerald-100/85">{t("game.leaveConfirm.body")}</p>
      <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100">
        {t("game.leaveConfirm.warning")}
      </p>
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
          data-testid="leave-room-confirm-accept"
          className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400"
        >
          {t("game.leaveConfirm.confirm")}
        </button>
      </div>
    </div>
  </div>
);
