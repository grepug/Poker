import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type {
  Card as PlayingCard,
  CompletedHandHistoryAction,
  CompletedHandHistoryExport,
  CompletedHandHistorySeat,
  SavedGameAnalysisStatus,
  SavedGameDetail,
  SavedGameHandAnalysis,
  SavedGameLocalizedAnalysis,
} from "poker-types";
import { Card } from "@/components/Card";
import { useLocalization } from "@/contexts/LocalizationContext";
import type { MessageKey } from "@/i18n/messages";
import { savedGameHistoryService } from "@/services/saved-game-history.service";

const formatDateTime = (value: number, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

const formatCurrency = (value: number) => `${value >= 0 ? "+" : "-"}$${Math.abs(value)}`;

const suitSymbols: Record<PlayingCard["suit"], string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const describeSeatCards = (
  seat: CompletedHandHistorySeat,
  hiddenLabel: string,
) =>
  seat.holeCards && seat.holeCards.length > 0
    ? seat.holeCards
        .map((card) => `${card.rank}${suitSymbols[card.suit]}`)
        .join(" ")
    : hiddenLabel;

const describeAction = (
  action: CompletedHandHistoryAction,
  blindLabel: string,
) => {
  if (action.action === "post-blind") {
    return `${blindLabel} ${action.blindType ?? ""} $${action.amount}`.trim();
  }
  if (action.amount > 0) {
    return `${action.action} $${action.amount}`;
  }
  return action.action;
};

const ANALYSIS_STATUS_KEYS: Record<SavedGameAnalysisStatus, MessageKey> = {
  pending: "history.analysisStatus.pending",
  ready: "history.analysisStatus.ready",
  failed: "history.analysisStatus.failed",
  unavailable: "history.analysisStatus.unavailable",
};

const getAnalysisStatusKey = (status: SavedGameAnalysisStatus): MessageKey =>
  ANALYSIS_STATUS_KEYS[status];

const getDisplayedCommunityCards = (
  history: CompletedHandHistoryExport,
) =>
  history.communityCardsByStreet.river.length > 0
    ? history.communityCardsByStreet.river
    : history.communityCardsByStreet.turn.length > 0
      ? history.communityCardsByStreet.turn
      : history.communityCardsByStreet.flop.length > 0
        ? history.communityCardsByStreet.flop
        : history.communityCardsByStreet.preFlop;

const getRequestedAnalysisLocale = (locale: string) => {
  const normalized = locale.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) {
    return "en";
  }
  if (normalized === "en" || normalized.startsWith("en_")) {
    return "en";
  }
  if (
    normalized === "zh_hans" ||
    normalized === "zh_cn" ||
    normalized === "zh_hans_cn"
  ) {
    return "zh_hans";
  }
  return /^[a-z]{2,3}(?:_[a-z0-9]{2,8})*$/.test(normalized)
    ? normalized
    : "en";
};

const toCanonicalAnalysisContent = (
  analysis: SavedGameHandAnalysis,
): SavedGameLocalizedAnalysis => ({
  status: analysis.status,
  updatedAt: analysis.updatedAt,
  headline: analysis.headline ?? null,
  summary: analysis.summary ?? null,
  keyAdjustments: analysis.keyAdjustments ?? [],
  failureReason: analysis.failureReason ?? null,
});

const getDisplayedAnalysis = (
  analysis: SavedGameHandAnalysis,
  locale: string,
) => {
  const requestedLocale = getRequestedAnalysisLocale(locale);
  const requestedLocalized = analysis.localizedByLocale?.[requestedLocale];
  const englishLocalized = analysis.localizedByLocale?.en;
  const content =
    requestedLocalized?.status === "ready"
      ? requestedLocalized
      : englishLocalized?.status === "ready"
        ? englishLocalized
        : toCanonicalAnalysisContent(analysis);
  const status =
    requestedLocalized && requestedLocalized.status !== "ready"
      ? requestedLocalized.status
      : analysis.status;
  const failureReason =
    requestedLocalized && requestedLocalized.status !== "ready"
      ? requestedLocalized.failureReason ?? analysis.failureReason ?? null
      : analysis.failureReason ?? null;

  return {
    status,
    failureReason,
    headline: content.headline ?? null,
    summary: content.summary ?? null,
    keyAdjustments: content.keyAdjustments ?? [],
  };
};

type TranslationFn = (
  key: MessageKey,
  values?: Record<string, string | number>,
) => string;

type SavedGameDetailViewProps = {
  detail: SavedGameDetail;
  selectedHandNumber: number | null;
  locale: string;
  localeTag: string;
  t: TranslationFn;
  onBackToHistory: () => void;
  onBackToLobby: () => void;
  onSelectHandNumber: (handNumber: number) => void;
};

type SavedGameDetailShellProps = {
  title: string;
  subtitle?: string | null;
  onBackToHistory: () => void;
  onBackToLobby: () => void;
  t: TranslationFn;
  children: React.ReactNode;
  testId?: string;
};

type MobileDetailSection = "overview" | "actions" | "review" | "session";

const MOBILE_DETAIL_SECTIONS: Array<{
  id: MobileDetailSection;
  labelKey: MessageKey;
}> = [
  { id: "overview", labelKey: "history.mobileSection.overview" },
  { id: "actions", labelKey: "history.actions" },
  { id: "review", labelKey: "history.mobileSection.review" },
  { id: "session", labelKey: "history.mobileSection.session" },
];

const SectionShell: React.FC<{
  children: React.ReactNode;
  className?: string;
  testId?: string;
}> = ({ children, className = "", testId }) => (
  <section
    className={`rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5 ${className}`.trim()}
    data-testid={testId}
  >
    {children}
  </section>
);

const SummaryStatCard: React.FC<{
  label: string;
  value: string | number;
  valueClassName?: string;
}> = ({ label, value, valueClassName = "text-xl" }) => (
  <article className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
    <p className="text-xs uppercase tracking-wide text-emerald-100/60">{label}</p>
    <p className={`mt-1 font-semibold text-white ${valueClassName}`.trim()}>{value}</p>
  </article>
);

const ParticipantStandingsTable: React.FC<{
  detail: SavedGameDetail;
  t: TranslationFn;
}> = ({ detail, t }) => (
  <div className="mt-4 overflow-x-auto rounded-xl border border-emerald-700/60">
    <table className="min-w-full text-sm">
      <thead className="bg-emerald-950/70 text-emerald-100/70">
        <tr>
          <th className="px-3 py-2 text-left font-semibold">{t("game.rankings.player")}</th>
          <th className="px-3 py-2 text-right font-semibold">{t("game.final.finalChips")}</th>
          <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.handsWon")}</th>
          <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.vpipHands")}</th>
          <th className="px-3 py-2 text-right font-semibold">{t("game.rankings.net")}</th>
        </tr>
      </thead>
      <tbody className="bg-emerald-950/35">
        {detail.participants.map((participant) => (
          <tr
            key={participant.playerId}
            className="border-t border-emerald-800/60 text-emerald-50"
          >
            <td className="px-3 py-2">
              {participant.avatarEmoji ? `${participant.avatarEmoji} ` : ""}
              {participant.playerName}
              {participant.playerId === detail.requesterPlayerId
                ? ` (${t("common.you")})`
                : ""}
            </td>
            <td className="px-3 py-2 text-right">${participant.finalChips}</td>
            <td className="px-3 py-2 text-right">{participant.handsWonCount}</td>
            <td className="px-3 py-2 text-right">
              {participant.vpipHandsCount} ({Math.round(participant.vpipRate * 100)}%)
            </td>
            <td
              className={`px-3 py-2 text-right font-semibold ${
                participant.profit >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {formatCurrency(participant.profit)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const ParticipantStandingsCards: React.FC<{
  detail: SavedGameDetail;
  t: TranslationFn;
}> = ({ detail, t }) => (
  <div className="mt-4 space-y-3">
    {detail.participants.map((participant, index) => (
      <div
        key={participant.playerId}
        className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-4 text-sm text-emerald-50"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/50">
              #{index + 1}
            </p>
            <p className="mt-1 font-semibold text-white">
              {participant.avatarEmoji ? `${participant.avatarEmoji} ` : ""}
              {participant.playerName}
              {participant.playerId === detail.requesterPlayerId
                ? ` (${t("common.you")})`
                : ""}
            </p>
          </div>
          <p
            className={`text-base font-semibold ${
              participant.profit >= 0 ? "text-emerald-300" : "text-rose-300"
            }`}
          >
            {formatCurrency(participant.profit)}
          </p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
              {t("game.final.finalChips")}
            </p>
            <p className="mt-1 font-semibold text-white">${participant.finalChips}</p>
          </div>
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
              {t("game.rankings.handsWon")}
            </p>
            <p className="mt-1 font-semibold text-white">{participant.handsWonCount}</p>
          </div>
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
              {t("game.rankings.vpipHands")}
            </p>
            <p className="mt-1 font-semibold text-white">
              {participant.vpipHandsCount} ({Math.round(participant.vpipRate * 100)}%)
            </p>
          </div>
          <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
              {t("game.final.summary.totalBuyIn")}
            </p>
            <p className="mt-1 font-semibold text-white">${participant.totalBuyIn}</p>
          </div>
        </div>
      </div>
    ))}
  </div>
);

const SeatList: React.FC<{
  detail: SavedGameDetail;
  selectedHand: SavedGameDetail["hands"][number];
  t: TranslationFn;
}> = ({ detail, selectedHand, t }) => (
  <div className="space-y-2">
    {selectedHand.history.seats.map((seat) => (
      <div
        key={`${selectedHand.handNumber}-${seat.playerId}`}
        className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-3 text-sm text-emerald-50"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            {seat.playerName}
            {seat.playerId === detail.requesterPlayerId ? ` (${t("common.you")})` : ""}
          </span>
          <span className="text-emerald-100/70">
            {seat.positionLabel ?? t("history.noPosition")}
          </span>
        </div>
        <p className="mt-1 text-emerald-100/75">
          {t("history.startingStack", {
            amount: seat.startingStack,
          })}
        </p>
        <p className="mt-1 text-emerald-100/75">
          {describeSeatCards(seat, t("history.hiddenCards"))}
        </p>
      </div>
    ))}
  </div>
);

const ActionList: React.FC<{
  selectedHand: SavedGameDetail["hands"][number];
  t: TranslationFn;
  compact?: boolean;
}> = ({ selectedHand, t, compact = false }) => (
  <div className={`space-y-2 ${compact ? "" : "max-h-80 overflow-y-auto pr-1"}`.trim()}>
    {selectedHand.history.actions.map((action) => (
      <div
        key={`${selectedHand.handNumber}-${action.order}`}
        className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-3 text-sm text-emerald-50"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">
            #{action.order} {action.playerName}
          </span>
          <span className="text-emerald-100/70">{action.street}</span>
        </div>
        <p className="mt-1 text-emerald-100/80">
          {describeAction(action, t("history.blindAction"))}
        </p>
        <p className="mt-1 text-emerald-100/60">
          {t("history.potAfter", { amount: action.potAfter })}
        </p>
      </div>
    ))}
  </div>
);

const NetSummary: React.FC<{
  detail: SavedGameDetail;
  selectedHand: SavedGameDetail["hands"][number];
  t: TranslationFn;
}> = ({ detail, selectedHand, t }) => (
  <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-4">
    <p className="text-xs uppercase tracking-wide text-emerald-100/60">
      {t("history.netSummary")}
    </p>
    <div className="mt-3 space-y-2">
      {Object.entries(selectedHand.history.settlement.netByPlayerId).map(
        ([playerId, net]) => {
          const player = detail.participants.find(
            (participant) => participant.playerId === playerId,
          );
          return (
            <div
              key={`${selectedHand.handNumber}-${playerId}`}
              className="flex items-center justify-between gap-3 text-sm text-emerald-50"
            >
              <span>{player?.playerName ?? playerId}</span>
              <span className={net >= 0 ? "text-emerald-300" : "text-rose-300"}>
                {formatCurrency(net)}
              </span>
            </div>
          );
        },
      )}
    </div>
  </div>
);

const AnalysisPanel: React.FC<{
  selectedHand: SavedGameDetail["hands"][number];
  selectedHandAnalysis: ReturnType<typeof getDisplayedAnalysis> | null;
  t: TranslationFn;
}> = ({ selectedHand, selectedHandAnalysis, t }) => (
  <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-4">
    <p className="text-xs uppercase tracking-wide text-emerald-100/60">
      {t(getAnalysisStatusKey(selectedHandAnalysis?.status ?? "pending"))}
    </p>
    {selectedHandAnalysis?.headline || selectedHandAnalysis?.summary ? (
      <>
        <h3 className="mt-2 text-base font-semibold text-white">
          {selectedHandAnalysis?.headline}
        </h3>
        <p className="mt-2 text-sm text-emerald-100/80">
          {selectedHandAnalysis?.summary}
        </p>
        <ul className="mt-3 space-y-2 text-sm text-emerald-50">
          {(selectedHandAnalysis?.keyAdjustments ?? []).map((adjustment) => (
            <li
              key={`${selectedHand.handNumber}-${adjustment}`}
              className="rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-3 py-2"
            >
              {adjustment}
            </li>
          ))}
        </ul>
      </>
    ) : (
      <p className="mt-2 text-sm text-emerald-100/80">
        {selectedHandAnalysis?.failureReason || t("history.analysisPending")}
      </p>
    )}
  </div>
);

const MobileSectionTabButton: React.FC<{
  id: MobileDetailSection;
  isActive: boolean;
  label: string;
  onClick: (id: MobileDetailSection) => void;
}> = ({ id, isActive, label, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(id)}
    data-testid={`saved-history-mobile-tab-${id}`}
    aria-pressed={isActive}
    className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
      isActive
        ? "border-emerald-300 bg-emerald-400/15 text-white"
        : "border-emerald-700/60 bg-emerald-900/20 text-emerald-100/75"
    }`}
  >
    {label}
  </button>
);

const MobileHandStripButton: React.FC<{
  hand: SavedGameDetail["hands"][number];
  isActive: boolean;
  statusLabel: string;
  t: TranslationFn;
  onSelect: (handNumber: number) => void;
}> = ({ hand, isActive, statusLabel, t, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect(hand.handNumber)}
    aria-pressed={isActive}
    className={`min-w-[9rem] snap-start rounded-2xl border px-4 py-3 text-left transition ${
      isActive
        ? "border-emerald-300 bg-emerald-400/15 text-white"
        : "border-emerald-700/60 bg-emerald-900/25 text-emerald-100/80"
    }`}
  >
    <div className="flex items-center justify-between gap-2">
      <span className="font-semibold">
        {t("history.handLabel", { handNumber: hand.handNumber })}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-emerald-200/75">
        {statusLabel}
      </span>
    </div>
    <p className="mt-2 text-xs text-emerald-100/60">
      {t("history.handPot", { amount: hand.history.settlement.totalPot })}
    </p>
  </button>
);

const SessionMetaCards: React.FC<{
  detail: SavedGameDetail;
  localeTag: string;
  t: TranslationFn;
}> = ({ detail, localeTag, t }) => (
  <div className="grid gap-2 sm:grid-cols-2">
    <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
        {t("history.started")}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">
        {formatDateTime(detail.startedAt, localeTag)}
      </p>
    </div>
    <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
        {t("history.concluded")}
      </p>
      <p className="mt-1 text-sm font-semibold text-white">
        {formatDateTime(detail.concludedAt, localeTag)}
      </p>
    </div>
  </div>
);

export const SavedGameDetailShell: React.FC<SavedGameDetailShellProps> = ({
  title,
  subtitle,
  onBackToHistory,
  onBackToLobby,
  t,
  children,
  testId,
}) => (
  <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
    <div className="relative mx-auto flex min-h-[85vh] w-full max-w-7xl items-start justify-center">
      <section className="surface-panel w-full space-y-6 p-6 md:p-8" data-testid={testId}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-2">
            <button
              type="button"
              onClick={onBackToHistory}
              className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200"
            >
              {t("history.backToHistory")}
            </button>
            <h1 className="text-3xl font-black tracking-tight text-white">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-emerald-100/75">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onBackToLobby}
            className="rounded-xl border border-emerald-500/70 px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
          >
            {t("history.backToLobby")}
          </button>
        </div>

        {children}
      </section>
    </div>
  </main>
);

export const SavedGameDetailView: React.FC<SavedGameDetailViewProps> = ({
  detail,
  selectedHandNumber,
  locale,
  localeTag,
  t,
  onBackToHistory,
  onBackToLobby,
  onSelectHandNumber,
}) => {
  const [mobileSection, setMobileSection] = useState<MobileDetailSection>("overview");

  const selectedHand =
    detail.hands.find((hand) => hand.handNumber === selectedHandNumber) ?? null;
  const selectedHandAnalysis = selectedHand
    ? getDisplayedAnalysis(selectedHand.analysis, locale)
    : null;

  return (
    <SavedGameDetailShell
      title={t("history.roomLabel", { roomId: detail.roomId })}
      subtitle={formatDateTime(detail.concludedAt, localeTag)}
      onBackToHistory={onBackToHistory}
      onBackToLobby={onBackToLobby}
      t={t}
      testId="saved-game-detail-page"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryStatCard label={t("history.hands")} value={detail.handCount} />
            <SummaryStatCard
              label={t("history.blinds")}
              value={`${detail.blinds.smallBlind}/${detail.blinds.bigBlind}`}
            />
            <SummaryStatCard
              label={t("history.started")}
              value={formatDateTime(detail.startedAt, localeTag)}
              valueClassName="text-sm leading-5"
            />
            <SummaryStatCard
              label={t("history.concluded")}
              value={formatDateTime(detail.concludedAt, localeTag)}
              valueClassName="text-sm leading-5"
            />
      </div>

      <div className="space-y-4 lg:hidden">
            <SectionShell testId="saved-history-mobile-hand-strip">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-white">{t("history.handList")}</h2>
                  <p className="mt-1 text-sm text-emerald-100/70">
                    {t("history.playerCount", { count: detail.participants.length })}
                  </p>
                </div>
                {selectedHand && (
                  <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-2 text-sm text-emerald-100/80">
                    {t("history.actionsCount", {
                      count: selectedHand.history.actions.length,
                    })}
                  </div>
                )}
              </div>
              <div className="mt-4 -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
                {detail.hands.map((hand) => (
                  <MobileHandStripButton
                    key={`${detail.archiveId}-${hand.handNumber}`}
                    hand={hand}
                    isActive={hand.handNumber === selectedHandNumber}
                    statusLabel={t(
                      getAnalysisStatusKey(getDisplayedAnalysis(hand.analysis, locale).status),
                    )}
                    t={t}
                    onSelect={onSelectHandNumber}
                  />
                ))}
              </div>
            </SectionShell>

            {selectedHand && (
              <>
                <SectionShell testId="saved-history-mobile-selected-hand">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        {t("history.handLabel", { handNumber: selectedHand.handNumber })}
                      </h2>
                      <p className="mt-1 text-sm text-emerald-100/70">
                        {t("history.handPot", {
                          amount: selectedHand.history.settlement.totalPot,
                        })}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-2 text-sm text-emerald-100/80">
                      {t(getAnalysisStatusKey(selectedHandAnalysis?.status ?? "pending"))}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                      {t("game.communityCards")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {getDisplayedCommunityCards(selectedHand.history).map((card, index) => (
                        <Card
                          key={`${selectedHand.handNumber}-${card.rank}-${card.suit}-${index}`}
                          card={card}
                          size="small"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
                        {t("history.seats")}
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {selectedHand.history.seats.length}
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
                        {t("history.actions")}
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {selectedHand.history.actions.length}
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-emerald-100/50">
                        {t("history.analysisTitle")}
                      </p>
                      <p className="mt-1 font-semibold text-white">
                        {t(getAnalysisStatusKey(selectedHandAnalysis?.status ?? "pending"))}
                      </p>
                    </div>
                  </div>
                </SectionShell>

                <SectionShell>
                  <div
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                    data-testid="saved-history-mobile-section-tabs"
                  >
                    {MOBILE_DETAIL_SECTIONS.map((section) => (
                      <MobileSectionTabButton
                        key={section.id}
                        id={section.id}
                        isActive={mobileSection === section.id}
                        label={t(section.labelKey)}
                        onClick={setMobileSection}
                      />
                    ))}
                  </div>
                </SectionShell>

                {mobileSection === "overview" && (
                  <SectionShell testId="saved-history-mobile-overview-panel">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                        {t("history.seats")}
                      </p>
                      <div className="mt-2">
                        <SeatList
                          detail={detail}
                          selectedHand={selectedHand}
                          t={t}
                        />
                      </div>
                    </div>
                    <div className="mt-4">
                      <NetSummary detail={detail} selectedHand={selectedHand} t={t} />
                    </div>
                  </SectionShell>
                )}

                {mobileSection === "actions" && (
                  <SectionShell>
                    <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                      {t("history.actions")}
                    </p>
                    <div className="mt-2">
                      <ActionList selectedHand={selectedHand} t={t} compact />
                    </div>
                  </SectionShell>
                )}

                {mobileSection === "review" && (
                  <SectionShell>
                    <h2 className="text-lg font-bold text-white">
                      {t("history.analysisTitle")}
                    </h2>
                    <div className="mt-4">
                      <AnalysisPanel
                        selectedHand={selectedHand}
                        selectedHandAnalysis={selectedHandAnalysis}
                        t={t}
                      />
                    </div>
                  </SectionShell>
                )}

                {mobileSection === "session" && (
                  <SectionShell testId="saved-history-mobile-session-panel">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold text-white">{t("history.standings")}</h2>
                      <span className="text-xs uppercase tracking-wide text-emerald-100/60">
                        {t("history.playerCount", { count: detail.participants.length })}
                      </span>
                    </div>
                    <div className="mt-4">
                      <SessionMetaCards detail={detail} localeTag={localeTag} t={t} />
                    </div>
                    <ParticipantStandingsCards detail={detail} t={t} />
                  </SectionShell>
                )}
              </>
            )}
      </div>

      <div className="hidden gap-6 lg:grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-6">
              <SectionShell testId="saved-history-desktop-standings">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-bold text-white">{t("history.standings")}</h2>
                  <span className="text-xs uppercase tracking-wide text-emerald-100/60">
                    {t("history.playerCount", { count: detail.participants.length })}
                  </span>
                </div>
                <ParticipantStandingsTable detail={detail} t={t} />
              </SectionShell>

              {selectedHand && (
                <SectionShell>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-white">
                        {t("history.handLabel", { handNumber: selectedHand.handNumber })}
                      </h2>
                      <p className="mt-1 text-sm text-emerald-100/70">
                        {t("history.handPot", {
                          amount: selectedHand.history.settlement.totalPot,
                        })}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-2 text-sm text-emerald-100/80">
                      {t("history.actionsCount", {
                        count: selectedHand.history.actions.length,
                      })}
                    </div>
                  </div>

                  <div className="mt-4">
                    <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                      {t("game.communityCards")}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {getDisplayedCommunityCards(selectedHand.history).map((card, index) => (
                        <Card
                          key={`${selectedHand.handNumber}-${card.rank}-${card.suit}-${index}`}
                          card={card}
                          size="small"
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 xl:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                        {t("history.seats")}
                      </p>
                      <div className="mt-2">
                        <SeatList detail={detail} selectedHand={selectedHand} t={t} />
                      </div>
                    </div>

                    <div>
                      <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                        {t("history.actions")}
                      </p>
                      <div className="mt-2">
                        <ActionList selectedHand={selectedHand} t={t} />
                      </div>
                    </div>
                  </div>
                </SectionShell>
              )}
            </div>

            <aside className="space-y-6">
              <SectionShell testId="saved-history-desktop-hand-list">
                <h2 className="text-lg font-bold text-white">{t("history.handList")}</h2>
                <div className="mt-4 space-y-2">
                  {detail.hands.map((hand) => (
                    <button
                      key={`${detail.archiveId}-${hand.handNumber}`}
                      type="button"
                      onClick={() => onSelectHandNumber(hand.handNumber)}
                      className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                        hand.handNumber === selectedHandNumber
                          ? "border-emerald-300 bg-emerald-400/15 text-white"
                          : "border-emerald-700/60 bg-emerald-900/25 text-emerald-100/80 hover:bg-emerald-800/35"
                      }`}
                    >
                      {(() => {
                        const displayedAnalysis = getDisplayedAnalysis(
                          hand.analysis,
                          locale,
                        );
                        return (
                          <>
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-semibold">
                                {t("history.handLabel", { handNumber: hand.handNumber })}
                              </span>
                              <span
                                className={`text-xs uppercase tracking-wide ${
                                  displayedAnalysis.status === "ready"
                                    ? "text-emerald-300"
                                    : displayedAnalysis.status === "failed"
                                      ? "text-rose-300"
                                      : "text-amber-200"
                                }`}
                              >
                                {t(getAnalysisStatusKey(displayedAnalysis.status))}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-emerald-100/60">
                              {t("history.handPot", {
                                amount: hand.history.settlement.totalPot,
                              })}
                            </p>
                          </>
                        );
                      })()}
                    </button>
                  ))}
                </div>
              </SectionShell>

              {selectedHand && (
                <SectionShell>
                  <h2 className="text-lg font-bold text-white">
                    {t("history.analysisTitle")}
                  </h2>
                  <div className="mt-4">
                    <AnalysisPanel
                      selectedHand={selectedHand}
                      selectedHandAnalysis={selectedHandAnalysis}
                      t={t}
                    />
                  </div>

                  <div className="mt-4">
                    <NetSummary detail={detail} selectedHand={selectedHand} t={t} />
                  </div>
                </SectionShell>
              )}
            </aside>
      </div>
    </SavedGameDetailShell>
  );
};

export const SavedGameDetailPage: React.FC = () => {
  const { archiveId = "" } = useParams();
  const navigate = useNavigate();
  const { locale, t } = useLocalization();
  const [detail, setDetail] = useState<SavedGameDetail | null>(null);
  const [selectedHandNumber, setSelectedHandNumber] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!archiveId) {
        setError(t("history.detailMissing"));
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const nextDetail = await savedGameHistoryService.getSavedGameDetail(
          archiveId,
          locale,
        );
        if (!cancelled) {
          setDetail(nextDetail);
          setSelectedHandNumber((current) =>
            nextDetail.hands.some((hand) => hand.handNumber === current)
              ? current
              : nextDetail.hands[0]?.handNumber ?? null,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("history.detailLoadFailed"),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [archiveId, locale, t]);

  const localeTag = useMemo(
    () => (locale === "zh_hans" ? "zh-Hans-CN" : "en-US"),
    [locale],
  );

  return (
    <>
      {isLoading && (
        <SavedGameDetailShell
          title={t("history.detailTitle")}
          onBackToHistory={() => navigate("/history")}
          onBackToLobby={() => navigate("/", { replace: true })}
          t={t}
        >
          <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/35 px-4 py-5 text-sm text-emerald-100/80">
            {t("history.detailLoading")}
          </div>
        </SavedGameDetailShell>
      )}

      {error && !isLoading && (
        <SavedGameDetailShell
          title={t("history.detailTitle")}
          onBackToHistory={() => navigate("/history")}
          onBackToLobby={() => navigate("/", { replace: true })}
          t={t}
        >
          <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
            {error}
          </div>
        </SavedGameDetailShell>
      )}

      {!isLoading && !error && detail && (
        <SavedGameDetailView
          detail={detail}
          selectedHandNumber={selectedHandNumber}
          locale={locale}
          localeTag={localeTag}
          t={t}
          onBackToHistory={() => navigate("/history")}
          onBackToLobby={() => navigate("/", { replace: true })}
          onSelectHandNumber={setSelectedHandNumber}
        />
      )}
    </>
  );
};
