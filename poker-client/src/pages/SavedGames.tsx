import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SavedGameSummary } from "poker-types";
import { useLocalization } from "@/contexts/LocalizationContext";
import { savedGameHistoryService } from "@/services/saved-game-history.service";

const formatDateTime = (value: number, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));

export const SavedGamesPage: React.FC = () => {
  const navigate = useNavigate();
  const { locale, t } = useLocalization();
  const [savedGames, setSavedGames] = useState<SavedGameSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const nextSavedGames = await savedGameHistoryService.listSavedGames();
        if (!cancelled) {
          setSavedGames(nextSavedGames);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : t("history.listLoadFailed"),
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
  }, [t]);

  const localeTag = useMemo(
    () => (locale === "zh_hans" ? "zh-Hans-CN" : "en-US"),
    [locale],
  );

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8 md:px-6 md:py-12">
      <div className="relative mx-auto flex min-h-[85vh] w-full max-w-6xl items-start justify-center">
        <section className="surface-panel w-full space-y-6 p-6 md:p-8" data-testid="saved-games-page">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">
                {t("history.title")}
              </h1>
              <p className="text-sm text-emerald-100/75">
                {t("history.subtitle")}
              </p>
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
              {t("history.loading")}
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-rose-400/50 bg-rose-500/10 px-4 py-5 text-sm text-rose-100">
              {error}
            </div>
          )}

          {!isLoading && !error && savedGames.length === 0 && (
            <div className="rounded-xl border border-emerald-700/60 bg-emerald-950/35 px-4 py-8 text-center text-sm text-emerald-100/70">
              {t("history.empty")}
            </div>
          )}

          {!isLoading && !error && savedGames.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {savedGames.map((savedGame) => {
                const myStanding = savedGame.participants.find(
                  (participant) =>
                    participant.playerId === savedGame.requesterPlayerId,
                );
                return (
                  <article
                    key={savedGame.archiveId}
                    className="rounded-2xl border border-emerald-700/60 bg-emerald-950/45 p-5"
                    data-testid={`saved-game-card-${savedGame.archiveId}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-emerald-200/60">
                          {t("history.sessionLabel")}
                        </p>
                        <h2 className="mt-1 text-xl font-bold text-white">
                          {t("history.roomLabel", { roomId: savedGame.roomId })}
                        </h2>
                        <p className="mt-1 text-sm text-emerald-100/70">
                          {formatDateTime(savedGame.concludedAt, localeTag)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/history/${savedGame.archiveId}`)}
                        className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-emerald-950 transition hover:bg-emerald-400"
                      >
                        {t("history.open")}
                      </button>
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                          {t("history.hands")}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {savedGame.handCount}
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                          {t("history.blinds")}
                        </p>
                        <p className="mt-1 text-lg font-semibold text-white">
                          {savedGame.blinds.smallBlind}/{savedGame.blinds.bigBlind}
                        </p>
                      </div>
                      <div className="rounded-xl border border-emerald-700/60 bg-emerald-900/25 p-3">
                        <p className="text-xs uppercase tracking-wide text-emerald-100/60">
                          {t("history.myNet")}
                        </p>
                        <p
                          className={`mt-1 text-lg font-semibold ${
                            (myStanding?.profit ?? 0) >= 0
                              ? "text-emerald-300"
                              : "text-rose-300"
                          }`}
                        >
                          {(myStanding?.profit ?? 0) >= 0 ? "+" : ""}${myStanding?.profit ?? 0}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {savedGame.participants.slice(0, 5).map((participant) => (
                        <span
                          key={`${savedGame.archiveId}-${participant.playerId}`}
                          className="rounded-full border border-emerald-600/60 bg-emerald-900/25 px-3 py-1 text-xs text-emerald-100/80"
                        >
                          {participant.avatarEmoji ? `${participant.avatarEmoji} ` : ""}
                          {participant.playerName}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
};
