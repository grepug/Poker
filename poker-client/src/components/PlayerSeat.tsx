import React from "react";
import type { Player as PlayerType } from "poker-types";
import { Card } from "./Card";

interface PlayerSeatProps {
  player: PlayerType | null;
  isCurrentPlayer?: boolean;
  isDealer?: boolean;
  showCards?: boolean;
  isYou?: boolean;
  seatNumber?: number;
  position: "top" | "right" | "bottom" | "left";
  dataTestId?: string;
}

export const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  isCurrentPlayer = false,
  isDealer = false,
  showCards = false,
  isYou = false,
  seatNumber,
  dataTestId,
}) => {
  if (!player) {
    return (
      <div
        data-testid={dataTestId}
        className="rounded-xl border border-dashed border-emerald-800/80 bg-emerald-950/25 p-3"
      >
        <span className="text-sm text-emerald-200/50">Empty Seat</span>
      </div>
    );
  }

  const isConnected =
    player.status === "connected" ||
    player.status === "waiting" ||
    player.status === "all-in";
  const isFolded = player.status === "folded";

  return (
    <div
      data-testid={dataTestId}
      className={`relative rounded-xl border p-3 transition ${
        isCurrentPlayer
          ? "turn-glow border-amber-300/90 bg-amber-300/10"
          : isConnected
            ? "border-emerald-700/80 bg-emerald-950/60"
            : "border-slate-700 bg-slate-900/50"
      } ${isFolded ? "opacity-60" : "opacity-100"}`}
    >
      {isDealer && (
        <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-amber-300 text-xs font-black text-amber-950 shadow-md">
          D
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {typeof seatNumber === "number" && (
              <span className="text-xs font-semibold text-emerald-100/65">
                #{seatNumber}
              </span>
            )}
            <span className="truncate text-white font-semibold">
              {player.name} {isYou ? "(You)" : ""}
            </span>
          </div>
          <div className="text-green-400 text-sm">${player.chips}</div>
        </div>

        <div className="text-right">
          {player.currentBet > 0 && (
            <div className="text-yellow-300 text-sm font-semibold">
              Bet: ${player.currentBet}
            </div>
          )}
          {player.status === "all-in" && (
            <div className="text-orange-300 text-xs font-semibold">ALL-IN</div>
          )}
          {isFolded && <div className="text-red-400 text-xs font-semibold">FOLDED</div>}
        </div>
      </div>

      {player.cards && player.cards.length > 0 && (
        <div className="mt-2 flex gap-1">
          {player.cards.map((card, idx) => (
            <Card
              key={idx}
              card={card}
              size="small"
              faceDown={!showCards}
              dataTestId={`${dataTestId}-card-${idx}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};
