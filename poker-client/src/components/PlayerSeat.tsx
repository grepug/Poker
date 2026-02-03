import React from "react";
import type { Player as PlayerType } from "poker-types";
import { Card } from "./Card";

interface PlayerSeatProps {
  player: PlayerType | null;
  isCurrentPlayer?: boolean;
  isDealer?: boolean;
  showCards?: boolean;
  position: "top" | "right" | "bottom" | "left";
}

export const PlayerSeat: React.FC<PlayerSeatProps> = ({
  player,
  isCurrentPlayer = false,
  isDealer = false,
  showCards = false,
}) => {
  if (!player) {
    return (
      <div className="w-32 h-40 border-2 border-dashed border-gray-600 rounded-lg flex items-center justify-center bg-gray-800/30">
        <span className="text-gray-600 text-sm">Empty</span>
      </div>
    );
  }

  const isConnected =
    player.status === "connected" || player.status === "waiting";
  const isFolded = player.status === "folded";

  return (
    <div
      className={`relative ${isCurrentPlayer ? "ring-4 ring-yellow-400" : ""}`}
    >
      <div
        className={`w-32 p-3 rounded-lg ${isConnected ? "bg-green-800" : "bg-gray-700"} ${isFolded ? "opacity-50" : ""}`}
      >
        {/* Dealer button */}
        {isDealer && (
          <div className="absolute -top-2 -right-2 w-8 h-8 bg-yellow-500 rounded-full flex items-center justify-center text-xs font-bold">
            D
          </div>
        )}

        {/* Player info */}
        <div className="text-white text-sm font-semibold truncate">
          {player.name}
        </div>
        <div className="text-green-400 text-xs">${player.chips}</div>

        {/* Current bet */}
        {player.currentBet > 0 && (
          <div className="mt-1 text-yellow-300 text-xs">
            Bet: ${player.currentBet}
          </div>
        )}

        {/* Cards */}
        {player.cards && player.cards.length > 0 && (
          <div className="flex gap-1 mt-2">
            {player.cards.map((card, idx) => (
              <Card key={idx} card={card} size="small" faceDown={!showCards} />
            ))}
          </div>
        )}

        {/* Status */}
        {isFolded && <div className="text-red-400 text-xs mt-1">FOLDED</div>}
      </div>
    </div>
  );
};
