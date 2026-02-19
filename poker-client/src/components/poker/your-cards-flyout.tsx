import React from "react";
import type { Card as PokerCard } from "poker-types";
import { Card } from "@/components/Card";

type YourCardsFlyoutProps = {
  isOpen: boolean;
  hasHoleCards: boolean;
  cards: PokerCard[];
  shouldAnchorToTurnDock: boolean;
  turnOverlayHeight: number;
  title: string;
  emptyOpenStateLabel: string;
  emptyClosedStateLabel: string;
  hideLabel: string;
  showLabel: string;
  onToggle: () => void;
};

export const YourCardsFlyout: React.FC<YourCardsFlyoutProps> = ({
  isOpen,
  hasHoleCards,
  cards,
  shouldAnchorToTurnDock,
  turnOverlayHeight,
  title,
  emptyOpenStateLabel,
  emptyClosedStateLabel,
  hideLabel,
  showLabel,
  onToggle,
}) => {
  return (
    <section
      className={`your-cards-flyout ${
        isOpen ? "your-cards-flyout--open" : "your-cards-flyout--closed"
      } ${shouldAnchorToTurnDock ? "your-cards-flyout--anchored" : "your-cards-flyout--bottom"}`}
      style={
        shouldAnchorToTurnDock
          ? {
              bottom: `calc(0.55rem + env(safe-area-inset-bottom, 0px) + ${turnOverlayHeight}px + 16px)`,
            }
          : undefined
      }
      data-testid="your-cards-flyout"
    >
      <div className="your-cards-flyout__panel" data-testid="your-cards-section">
        <div className="your-cards-flyout__header">
          <h3 className="your-cards-flyout__title">{title}</h3>
        </div>

        {isOpen && hasHoleCards ? (
          <div className="your-cards-flyout__cards">
            {cards.map((card, idx) => (
              <Card
                key={`your-card-${card.suit}-${card.rank}`}
                card={card}
                size="small"
                dataTestId={`your-card-${idx}`}
              />
            ))}
          </div>
        ) : (
          <div className="your-cards-flyout__empty-state" data-testid="hole-cards-hidden-state">
            {isOpen ? emptyOpenStateLabel : emptyClosedStateLabel}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="your-cards-flyout__toggle"
        data-testid="toggle-hole-cards"
        aria-label={`${isOpen ? hideLabel : showLabel} ${title}`}
      >
        {isOpen ? "<" : ">"}
      </button>
    </section>
  );
};
