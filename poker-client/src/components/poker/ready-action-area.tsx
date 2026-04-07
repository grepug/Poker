import React from "react";
import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

type ReadyPhase = "START_GAME" | "NEXT_HAND";

type RobotSeat = {
  id: string;
  name: string;
  emoji?: string;
};

type ReadyActionAreaProps = {
  phase: ReadyPhase;
  canReady: boolean;
  hasReadied: boolean;
  canEndGame: boolean;
  isHost: boolean;
  robots: RobotSeat[];
  onReady: () => void;
  onOpenEndGameConfirm: () => void;
  onAddRobot: () => void;
  onRemoveRobot: (playerId: string) => void;
  t: Translate;
};

export const ReadyActionArea: React.FC<ReadyActionAreaProps> = ({
  phase,
  canReady,
  hasReadied,
  canEndGame,
  isHost,
  robots,
  onReady,
  onOpenEndGameConfirm,
  onAddRobot,
  onRemoveRobot,
  t,
}) => {
  const readyButtonTestId =
    phase === "START_GAME" ? "start-game-button" : "start-next-hand-button";
  const sectionTestId =
    phase === "START_GAME" ? "ready-action-area" : "next-hand-action-area";

  return (
    <section className="operation-action-bar" data-testid={sectionTestId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-emerald-100">
            {phase === "START_GAME" ? t("game.ready.preGameTitle") : t("game.handComplete")}
          </h3>
          <p className="text-xs text-emerald-100/70">
            {phase === "START_GAME" ? t("game.ready.preGameHint") : t("game.handCompleteHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onReady}
            disabled={hasReadied || !canReady}
            data-testid={readyButtonTestId}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {hasReadied ? t("game.ready.waitingOthers") : t("common.ready")}
          </button>
          {canEndGame && (
            <button
              onClick={onOpenEndGameConfirm}
              data-testid="end-game-button"
              className="rounded-xl border border-rose-300/70 bg-rose-500/25 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/35"
            >
              {t("game.endGame")}
            </button>
          )}
        </div>
      </div>

      {isHost && (
        <div className="mt-3 rounded-lg border border-cyan-300/30 bg-cyan-900/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-cyan-100/90">
                {t("game.robot.sectionTitle")}
              </h4>
              <p className="text-xs text-cyan-100/70">{t("game.robot.hostHint")}</p>
            </div>
            <button
              onClick={onAddRobot}
              data-testid="add-robot-button"
              className="rounded-lg border border-cyan-300/70 bg-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-50 transition hover:bg-cyan-500/30"
            >
              {t("game.robot.add")}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {robots.length === 0 ? (
              <span className="text-xs text-cyan-100/65" data-testid="robot-empty-state">
                {t("game.robot.empty")}
              </span>
            ) : (
              robots.map((robot) => (
                <div
                  key={robot.id}
                  className="inline-flex items-center gap-2 rounded-md border border-cyan-300/35 bg-cyan-950/40 px-2 py-1"
                  data-testid={`robot-item-${robot.id}`}
                >
                  <span className="text-xs text-cyan-50">
                    {robot.emoji ? `${robot.emoji} ` : ""}
                    {robot.name}
                  </span>
                  <button
                    onClick={() => onRemoveRobot(robot.id)}
                    data-testid={`remove-robot-${robot.id}`}
                    className="rounded border border-rose-300/60 bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-100 transition hover:bg-rose-500/35"
                  >
                    {t("game.robot.remove")}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
};
