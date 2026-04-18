export type GameRoomPrimaryModal =
  | "settings"
  | "rankings"
  | "rules"
  | "handResults"
  | "finalSummary";

export type GameRoomConfirmModal = "endGameConfirm" | "leaveConfirm";

export type GameRoomModalState = {
  primary: GameRoomPrimaryModal | null;
  confirm: GameRoomConfirmModal | null;
};

export type GameRoomModalAction =
  | {
      type: "openPrimary";
      modal: GameRoomPrimaryModal;
    }
  | {
      type: "closePrimary";
      modal?: GameRoomPrimaryModal;
    }
  | {
      type: "openConfirm";
      modal: GameRoomConfirmModal;
    }
  | {
      type: "closeConfirm";
      modal?: GameRoomConfirmModal;
    }
  | {
      type: "dismissTopLayer";
    };

export const INITIAL_GAME_ROOM_MODAL_STATE: GameRoomModalState = {
  primary: null,
  confirm: null,
};

export const gameRoomModalReducer = (
  state: GameRoomModalState,
  action: GameRoomModalAction,
): GameRoomModalState => {
  switch (action.type) {
    case "openPrimary":
      return {
        ...state,
        primary: action.modal,
      };
    case "closePrimary":
      if (action.modal && state.primary !== action.modal) {
        return state;
      }

      return {
        ...state,
        primary: null,
      };
    case "openConfirm":
      return {
        ...state,
        confirm: action.modal,
      };
    case "closeConfirm":
      if (action.modal && state.confirm !== action.modal) {
        return state;
      }

      return {
        ...state,
        confirm: null,
      };
    case "dismissTopLayer":
      if (state.confirm) {
        return {
          ...state,
          confirm: null,
        };
      }

      if (state.primary) {
        return {
          ...state,
          primary: null,
        };
      }

      return state;
    default:
      return state;
  }
};
