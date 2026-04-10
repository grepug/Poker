import React from "react";
import type { Card as PokerCard } from "poker-types";
import { Card } from "@/components/Card";

type YourCardsFlyoutProps = {
  isOpen: boolean;
  hasHoleCards: boolean;
  cards: PokerCard[];
  bottomOffsetPx: number;
  placement?: "left-edge" | "bottom" | "felt-right" | "dock-left";
  title: string;
  emptyOpenStateLabel: string;
  emptyClosedStateLabel: string;
  hideLabel: string;
  showLabel: string;
  onToggle: () => void;
};

export const YourCardsFlyout = React.forwardRef<HTMLElement, YourCardsFlyoutProps>(
  (
    {
      isOpen,
      hasHoleCards,
      cards,
      bottomOffsetPx,
      placement,
      title,
      emptyOpenStateLabel,
      emptyClosedStateLabel,
      hideLabel,
      showLabel,
      onToggle,
    },
    ref,
  ) => {
    const resolvedPlacement = placement ?? "left-edge";

    return (
      <section
        ref={ref}
        className={`your-cards-flyout ${
          isOpen ? "your-cards-flyout--open" : "your-cards-flyout--closed"
        } ${
          resolvedPlacement === "felt-right"
            ? "your-cards-flyout--felt-right"
            : resolvedPlacement === "dock-left"
              ? "your-cards-flyout--dock-left"
            : resolvedPlacement === "bottom"
              ? "your-cards-flyout--bottom"
              : "your-cards-flyout--left-edge"
        } ${resolvedPlacement === "bottom" ? "your-cards-flyout--anchored" : ""}`}
        style={
          resolvedPlacement === "bottom"
            ? {
                bottom: `calc(0.55rem + env(safe-area-inset-bottom, 0px) + ${Math.max(0, bottomOffsetPx)}px)`,
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
  },
);

YourCardsFlyout.displayName = "YourCardsFlyout";
