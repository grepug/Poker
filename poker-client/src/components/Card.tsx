import React from "react";
import type { Card as CardType } from "poker-types";

interface CardProps {
  card: CardType | null;
  size?: "small" | "medium" | "large";
  faceDown?: boolean;
}

const suitSymbols: Record<string, string> = {
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
  spades: "♠",
};

const suitColors: Record<string, string> = {
  hearts: "text-red-600",
  diamonds: "text-red-600",
  clubs: "text-black",
  spades: "text-black",
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
}) => {
  if (!card || faceDown) {
    return (
      <div
        className={`${sizeClasses[size]} bg-blue-800 border-2 border-blue-900 rounded-lg flex items-center justify-center shadow-lg`}
      >
        <div className="text-white text-2xl">🂠</div>
      </div>
    );
  }

  return (
    <div
      className={`${sizeClasses[size]} bg-white border-2 border-gray-300 rounded-lg flex flex-col items-center justify-center shadow-lg`}
    >
      <div className={`font-bold ${suitColors[card.suit]}`}>{card.rank}</div>
      <div className={`text-2xl ${suitColors[card.suit]}`}>
        {suitSymbols[card.suit]}
      </div>
    </div>
  );
};
