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

  const selectedHand =
    detail?.hands.find((hand) => hand.handNumber === selectedHandNumber) ?? null;
  const selectedHandAnalysis = selectedHand
    ? getDisplayedAnalysis(selectedHand.analysis, locale)
    : null;

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="relative mx-auto flex min-h-[85vh] w-full max-w-7xl items-start justify-center">
        <section className="surface-panel w-full space-y-6 p-6 md:p-8" data-testid="saved-game-detail-page">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => navigate("/history")}
                className="text-sm font-semibold text-emerald-300 transition hover:text-emerald-200"
              >
                {t("history.backToHistory")}
              </button>
              <h1 className="text-3xl font-black tracking-tight text-white">
                {detail
                  ? t("history.roomLabel", { roomId: detail.roomId })
                  : t("history.detailTitle")}
              </h1>
              {detail && (
                <p className="text-sm text-emerald-100/75">
                  {formatDateTime(detail.concludedAt, localeTag)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="rounded-xl border border-emerald-500/70 px-4 py-3 font-semibold text-emerald-200 transition hover:bg-emerald-500/15"
            >
              {t("history.backToLobby")}
            </button>
          </div>

          {isLoading && (
            <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/35 px-4 py-5 text-sm text-emerald-100/80">
              {t("history.detailLoading")}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
              {error}
            </div>
          )}

          {!isLoading && !error && detail && (
            <>
              <div className="grid gap-3 lg:grid-cols-4">
                <article className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                    {t("history.hands")}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">{detail.handCount}</p>
                </article>
                <article className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                    {t("history.blinds")}
                  </p>
                  <p className="mt-1 text-xl font-semibold text-white">
                    {detail.blinds.smallBlind}/{detail.blinds.bigBlind}
                  </p>
                </article>
                <article className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                    {t("history.started")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatDateTime(detail.startedAt, localeTag)}
                  </p>
                </article>
                <article className="rounded-xl border border-emerald-700/60 bg-emerald-950/45 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                    {t("history.concluded")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">
                    {formatDateTime(detail.concludedAt, localeTag)}
                  </p>
                </article>
              </div>

              <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="space-y-6">
                  <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-lg font-bold text-white">{t("history.standings")}</h2>
                      <span className="text-xs uppercase tracking-wide text-emerald-100/60">
                        {t("history.playerCount", { count: detail.participants.length })}
                      </span>
                    </div>
                    <div className="mt-4 overflow-hidden rounded-xl border border-emerald-700/60">
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
                                {participant.profit >= 0 ? "+" : ""}${participant.profit}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {selectedHand && (
                    <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5">
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
                          {getDisplayedCommunityCards(selectedHand.history).map(
                            (card, index) => (
                              <Card
                                key={`${selectedHand.handNumber}-${card.rank}-${card.suit}-${index}`}
                                card={card}
                                size="small"
                              />
                            ),
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 xl:grid-cols-2">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                            {t("history.seats")}
                          </p>
                          <div className="mt-2 space-y-2">
                            {selectedHand.history.seats.map((seat) => (
                              <div
                                key={`${selectedHand.handNumber}-${seat.playerId}`}
                                className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-3 text-sm text-emerald-50"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold">
                                    {seat.playerName}
                                    {seat.playerId === detail.requesterPlayerId
                                      ? ` (${t("common.you")})`
                                      : ""}
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
                        </div>

                        <div>
                          <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                            {t("history.actions")}
                          </p>
                          <div className="mt-2 max-h-80 space-y-2 overflow-y-auto pr-1">
                            {selectedHand.history.actions.map((action) => (
                              <div
                                key={`${selectedHand.handNumber}-${action.order}`}
                                className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 px-3 py-3 text-sm text-emerald-50"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold">
                                    #{action.order} {action.playerName}
                                  </span>
                                  <span className="text-emerald-100/70">
                                    {action.street}
                                  </span>
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
                        </div>
                      </div>
                    </section>
                  )}
                </div>

                <aside className="space-y-6">
                  <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5">
                    <h2 className="text-lg font-bold text-white">{t("history.handList")}</h2>
                    <div className="mt-4 space-y-2">
                      {detail.hands.map((hand) => (
                        <button
                          key={`${detail.archiveId}-${hand.handNumber}`}
                          type="button"
                          onClick={() => setSelectedHandNumber(hand.handNumber)}
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
                  </section>

                  {selectedHand && (
                    <section className="rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5">
                      <h2 className="text-lg font-bold text-white">
                        {t("history.analysisTitle")}
                      </h2>
                      <div className="mt-4 rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-4">
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
                            {selectedHandAnalysis?.failureReason ||
                              t("history.analysisPending")}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-4">
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
                                  <span
                                    className={
                                      net >= 0 ? "text-emerald-300" : "text-rose-300"
                                    }
                                  >
                                    {formatCurrency(net)}
                                  </span>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    </section>
                  )}
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
};
