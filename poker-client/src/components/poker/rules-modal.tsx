import React from "react";
import type { MessageKey } from "@/i18n/messages";
import { PokerModalPanel, PokerModalShell } from "./modal-shell";

type Translate = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type RulesCopy = {
  modalTitle: string;
  modalSubtitle: string;
  objectiveTitle: string;
  objectiveBullets: string[];
  flowTitle: string;
  flowSteps: string[];
  actionsTitle: string;
  actionsBullets: string[];
  showdownTitle: string;
  showdownBullets: string[];
  tiebreakTitle: string;
  tiebreakBullets: string[];
  rankingTitle: string;
  rankingHint: string;
};

type RankingRow = {
  key: string;
  order: number;
  title: string;
  detail: string;
};

type RulesModalProps = {
  rulesCopy: RulesCopy;
  rankingRows: RankingRow[];
  onClose: () => void;
  t: Translate;
};

export const RulesModal: React.FC<RulesModalProps> = ({
  rulesCopy,
  rankingRows,
  onClose,
  t,
}) => (
  <PokerModalShell
    layout="centered"
    testId="rules-modal"
    className="bg-emerald-950/85"
    zIndexClassName="z-[77]"
  >
    <PokerModalPanel
      className="max-w-3xl p-4 md:p-6"
      ariaLabel={rulesCopy.modalTitle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">{rulesCopy.modalTitle}</h3>
          <p className="mt-1 text-sm text-emerald-100/80">{rulesCopy.modalSubtitle}</p>
        </div>
        <button
          onClick={onClose}
          data-testid="close-rules-button"
          className="rounded-lg border border-emerald-500/60 bg-emerald-900/35 px-3 py-1.5 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-800/45"
        >
          {t("common.close")}
        </button>
      </div>

      <div className="mt-4 space-y-3 text-sm text-emerald-100/90">
        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.objectiveTitle}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rulesCopy.objectiveBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.flowTitle}</h4>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            {rulesCopy.flowSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>

        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.actionsTitle}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rulesCopy.actionsBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.showdownTitle}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rulesCopy.showdownBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.tiebreakTitle}</h4>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {rulesCopy.tiebreakBullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-3">
          <h4 className="text-sm font-semibold text-white">{rulesCopy.rankingTitle}</h4>
          <p className="mt-1 text-xs text-emerald-100/75">{rulesCopy.rankingHint}</p>
          <ol className="mt-2 space-y-2">
            {rankingRows.map((row) => (
              <li
                key={row.key}
                className="rounded-lg border border-emerald-700/60 bg-emerald-900/30 px-3 py-2"
              >
                <p className="text-sm font-semibold text-white">
                  #{row.order} {row.title}
                </p>
                <p className="mt-1 text-xs text-emerald-100/80">{row.detail}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </PokerModalPanel>
  </PokerModalShell>
);
