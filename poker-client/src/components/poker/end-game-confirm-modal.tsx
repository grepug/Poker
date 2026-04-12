import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { PokerModalPanel, PokerModalShell } from "./modal-shell";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type EndGameConfirmModalProps = {
  onCancel: () => void;
  onConfirm: () => void;
  t: Translate;
};

export const EndGameConfirmModal: React.FC<EndGameConfirmModalProps> = ({
  onCancel,
  onConfirm,
  t,
}) => (
  <PokerModalShell
    layout="centered"
    testId="end-game-confirm-modal"
    zIndexClassName="z-[79]"
  >
    <PokerModalPanel className="max-w-md p-5" ariaLabel={t("game.endGameConfirm.title")}>
      <h3 className="text-lg font-black text-white">{t("game.endGameConfirm.title")}</h3>
      <p className="mt-2 text-sm text-emerald-100/85">{t("game.endGameConfirm.body")}</p>
      <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-300/15 px-3 py-2 text-xs font-semibold text-amber-100">
        {t("game.endGameConfirm.warning")}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={onCancel}
          data-testid="end-game-confirm-cancel"
          className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={onConfirm}
          data-testid="end-game-confirm-accept"
          className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-400"
        >
          {t("game.endGameConfirm.confirm")}
        </button>
      </div>
    </PokerModalPanel>
  </PokerModalShell>
);
