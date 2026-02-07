import React from "react";
import type { Card as CardType } from "poker-types";

interface CardProps {
  card: CardType | null;
  size?: "small" | "medium" | "large";
  faceDown?: boolean;
  dataTestId?: string;
}

const suitSymbols: Record<CardType["suit"], string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const suitColors: Record<CardType["suit"], string> = {
  hearts: "text-red-600",
  diamonds: "text-red-600",
  clubs: "text-slate-900",
  spades: "text-slate-900",
};

const sizeClasses = {
  small: "w-12 h-16 text-xs",
  medium: "w-16 h-24 text-base",
  large: "w-20 h-32 text-lg",
};

export const Card: React.FC<CardProps> = ({
  card,
  size = "medium",
  faceDown = false,
  dataTestId,
}) => {
  if (!card || faceDown) {
    return (
      <div
        data-testid={dataTestId}
        className={`${sizeClasses[size]} card-enter flex items-center justify-center overflow-hidden rounded-lg border-2 border-sky-900/70 bg-gradient-to-br from-sky-900 via-sky-800 to-slate-900 shadow-md`}
      >
        <div className="h-[82%] w-[82%] rounded-md border border-sky-300/25 bg-sky-950/30 p-1">
          <div className="h-full rounded-sm border border-sky-200/20 bg-[radial-gradient(circle_at_30%_30%,rgba(125,211,252,0.22)_0%,transparent_50%),radial-gradient(circle_at_75%_65%,rgba(56,189,248,0.22)_0%,transparent_48%)]" />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={dataTestId}
      data-rank={card.rank}
      data-suit={card.suit}
      className={`${sizeClasses[size]} card-enter relative overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-md`}
    >
      <div className={`absolute left-1.5 top-1 font-bold leading-none ${suitColors[card.suit]}`}>
        {card.rank}
      </div>
      <div className={`absolute bottom-1.5 right-1.5 rotate-180 font-bold leading-none ${suitColors[card.suit]}`}>
        {card.rank}
      </div>
      <div className={`flex h-full items-center justify-center text-2xl ${suitColors[card.suit]}`}>
        {suitSymbols[card.suit]}
      </div>
    </div>
  );
};
