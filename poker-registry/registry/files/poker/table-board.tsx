import React from "react";
import type { Card as PokerCard } from "poker-types";
import { Card } from "@/components/Card";
import { CommunityCardsLane } from "@/components/poker/community-cards-lane";
import { PotDropZone } from "@/components/poker/pot-drop-zone";
import { SeatPod } from "@/components/poker/seat-pod";

type SeatMainState = "turn" | "disconnected" | "all-in" | "folded" | "waiting" | "default";

type SeatActionLabel = {
  text: string;
  tone: "blind" | "aggressive" | "call" | "allin" | "pending";
};

type SeatOrbitItem = {
  slotIndex: number;
  top: string;
  left: string;
  width: string;
  playerId: string;
  playerEmoji: string;
  playerName: string;
  isYou: boolean;
  roleIcon: "dealer" | "small-blind" | null;
  roleLabel: string | null;
  externalStatusLabel: string | null;
  externalStatusToneClass: string;
  internalStatusLabel: string | null;
  internalStatusToneClass: string;
  actionLabel: SeatActionLabel | null;
  remainingLabel: string;
  seatState: SeatMainState;
  densityClass: string;
};

type TableBoardProps = {
  feltOvalRef: React.RefObject<HTMLDivElement | null>;
  potDropZoneRef: React.RefObject<HTMLDivElement | null>;
  setSeatNodeRef: (playerId: string, node: HTMLDivElement | null) => void;
  communitySlots: Array<PokerCard | null>;
  isYourTurn: boolean;
  isDragOverDropZone: boolean;
  potLabel: string;
  potValue: string;
  potHint: string | null;
  potPulse: boolean;
  seatOrbitItems: SeatOrbitItem[];
};

export const TableBoard: React.FC<TableBoardProps> = ({
  feltOvalRef,
  potDropZoneRef,
  setSeatNodeRef,
  communitySlots,
  isYourTurn,
  isDragOverDropZone,
  potLabel,
  potValue,
  potHint,
  potPulse,
  seatOrbitItems,
}) => {
  return (
    <section className="table-board-wrap" data-testid="table-board-section">
      <div ref={feltOvalRef} className="felt-oval">
        <div className="board-center-stack">
          <CommunityCardsLane>
            {communitySlots.map((card, idx) => {
              const isRevealed = Boolean(card);
              return (
                <div
                  key={`community-slot-${idx}-${card ? `${card.suit}-${card.rank}` : "back"}`}
                  className={isRevealed ? "community-reveal" : ""}
                  style={isRevealed ? { animationDelay: `${idx * 70}ms` } : undefined}
                >
                  <Card
                    card={card}
                    size="medium"
                    faceDown={!isRevealed}
                    dataTestId={isRevealed ? `community-card-${idx}` : `board-back-${idx}`}
                  />
                </div>
              );
            })}
          </CommunityCardsLane>

          <div ref={potDropZoneRef}>
            <PotDropZone
              active={isYourTurn}
              hover={isDragOverDropZone}
              label={potLabel}
              value={potValue}
              hint={potHint}
              pulse={potPulse}
            />
          </div>
        </div>

        <div className="seat-orbit" data-testid="players-section">
          {seatOrbitItems.map((item) => (
            <div
              key={`seat-slot-${item.slotIndex}`}
              className="seat-orbit__slot"
              style={{
                top: item.top,
                left: item.left,
                width: item.width,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div ref={(node) => setSeatNodeRef(item.playerId, node)}>
                <SeatPod
                  testId={`player-seat-${item.playerId}`}
                  playerEmoji={item.playerEmoji}
                  playerName={item.playerName}
                  isYou={item.isYou}
                  roleIcon={item.roleIcon}
                  roleLabel={item.roleLabel}
                  externalStatusLabel={item.externalStatusLabel}
                  externalStatusToneClass={item.externalStatusToneClass}
                  internalStatusLabel={item.internalStatusLabel}
                  internalStatusToneClass={item.internalStatusToneClass}
                  actionLabel={item.actionLabel}
                  remainingLabel={item.remainingLabel}
                  seatState={item.seatState}
                  densityClass={item.densityClass}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
