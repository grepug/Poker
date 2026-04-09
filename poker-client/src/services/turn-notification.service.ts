export const TURN_NOTIFICATION_AUDIO_PATH = "/audio/turn-notification.wav";

let sharedAudioElement: HTMLAudioElement | null = null;

const ensureAudioElement = (): HTMLAudioElement | null => {
  if (sharedAudioElement) {
    return sharedAudioElement;
  }

  if (typeof Audio === "undefined") {
    return null;
  }

  const audioElement = new Audio(TURN_NOTIFICATION_AUDIO_PATH);
  audioElement.preload = "auto";
  sharedAudioElement = audioElement;

  return sharedAudioElement;
};

export const shouldPlayTurnNotification = (
  previousIsYourTurn: boolean | null,
  isYourTurn: boolean,
): boolean => {
  if (previousIsYourTurn === null) {
    return isYourTurn;
  }

  return !previousIsYourTurn && isYourTurn;
};

export const applyTurnNotificationTransition = ({
  previousIsYourTurn,
  isYourTurn,
  onTurnStart,
}: {
  previousIsYourTurn: boolean | null;
  isYourTurn: boolean;
  onTurnStart: () => void;
}): boolean => {
  if (shouldPlayTurnNotification(previousIsYourTurn, isYourTurn)) {
    onTurnStart();
  }

  return isYourTurn;
};

export const playTurnNotification = async (): Promise<void> => {
  const audioElement = ensureAudioElement();
  if (!audioElement) {
    return;
  }

  audioElement.pause();
  audioElement.currentTime = 0;

  try {
    await audioElement.play();
  } catch {
    // Autoplay blocking is acceptable here; the visual turn cue still fires.
  }
};
