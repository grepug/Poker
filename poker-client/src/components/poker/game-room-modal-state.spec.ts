import { describe, expect, it } from "vitest";
import {
  gameRoomModalReducer,
  INITIAL_GAME_ROOM_MODAL_STATE,
} from "./game-room-modal-state";

describe("gameRoomModalReducer", () => {
  it("replaces a lower-priority informational modal when hand results take over", () => {
    const withRankings = gameRoomModalReducer(INITIAL_GAME_ROOM_MODAL_STATE, {
      type: "openPrimary",
      modal: "rankings",
    });

    const withHandResults = gameRoomModalReducer(withRankings, {
      type: "openPrimary",
      modal: "handResults",
    });

    expect(withRankings.primary).toBe("rankings");
    expect(withHandResults.primary).toBe("handResults");
  });

  it("keeps confirm dialogs in a separate overlay lane above the active primary modal", () => {
    const withHandResults = gameRoomModalReducer(INITIAL_GAME_ROOM_MODAL_STATE, {
      type: "openPrimary",
      modal: "handResults",
    });

    const withLeaveConfirm = gameRoomModalReducer(withHandResults, {
      type: "openConfirm",
      modal: "leaveConfirm",
    });

    expect(withLeaveConfirm.primary).toBe("handResults");
    expect(withLeaveConfirm.confirm).toBe("leaveConfirm");
  });

  it("dismisses the top-most confirm dialog before the primary modal", () => {
    const withDialogs = gameRoomModalReducer(
      gameRoomModalReducer(INITIAL_GAME_ROOM_MODAL_STATE, {
        type: "openPrimary",
        modal: "finalSummary",
      }),
      {
        type: "openConfirm",
        modal: "leaveConfirm",
      },
    );

    const afterFirstDismiss = gameRoomModalReducer(withDialogs, {
      type: "dismissTopLayer",
    });
    const afterSecondDismiss = gameRoomModalReducer(afterFirstDismiss, {
      type: "dismissTopLayer",
    });

    expect(afterFirstDismiss).toEqual({
      primary: "finalSummary",
      confirm: null,
    });
    expect(afterSecondDismiss).toEqual(INITIAL_GAME_ROOM_MODAL_STATE);
  });
});
