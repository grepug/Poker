type VoicePlaybackState = {
  sourceUrl: string | null;
  isPlaying: boolean;
};

type VoicePlaybackListener = (state: VoicePlaybackState) => void;

const listeners = new Set<VoicePlaybackListener>();
let playbackState: VoicePlaybackState = {
  sourceUrl: null,
  isPlaying: false,
};
let sharedAudioElement: HTMLAudioElement | null = null;

const notifyListeners = () => {
  for (const listener of listeners) {
    listener(playbackState);
  }
};

const setPlaybackState = (nextState: VoicePlaybackState) => {
  playbackState = nextState;
  notifyListeners();
};

const ensureAudioElement = (): HTMLAudioElement | null => {
  if (sharedAudioElement) {
    return sharedAudioElement;
  }

  if (typeof Audio === "undefined") {
    return null;
  }

  const audioElement = new Audio();
  audioElement.preload = "metadata";

  audioElement.addEventListener("play", () => {
    setPlaybackState({
      sourceUrl: playbackState.sourceUrl,
      isPlaying: true,
    });
  });

  audioElement.addEventListener("pause", () => {
    setPlaybackState({
      sourceUrl: playbackState.sourceUrl,
      isPlaying: false,
    });
  });

  audioElement.addEventListener("ended", () => {
    audioElement.currentTime = 0;
    setPlaybackState({
      sourceUrl: playbackState.sourceUrl,
      isPlaying: false,
    });
  });

  sharedAudioElement = audioElement;
  return sharedAudioElement;
};

export const getVoicePlaybackState = (): VoicePlaybackState => playbackState;

export const subscribeVoicePlayback = (
  listener: VoicePlaybackListener,
): (() => void) => {
  listeners.add(listener);
  listener(playbackState);

  return () => {
    listeners.delete(listener);
  };
};

export const playVoicePlayback = async (sourceUrl: string): Promise<void> => {
  const audioElement = ensureAudioElement();
  if (!audioElement) {
    return;
  }

  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) {
    return;
  }

  const isSameSource = playbackState.sourceUrl === normalizedUrl;
  if (!isSameSource) {
    audioElement.src = normalizedUrl;
    setPlaybackState({
      sourceUrl: normalizedUrl,
      isPlaying: false,
    });
  }

  if (!audioElement.paused && isSameSource) {
    return;
  }

  try {
    await audioElement.play();
  } catch {
    setPlaybackState({
      sourceUrl: normalizedUrl,
      isPlaying: false,
    });
  }
};

export const toggleVoicePlayback = async (sourceUrl: string): Promise<void> => {
  const audioElement = ensureAudioElement();
  if (!audioElement) {
    return;
  }

  const normalizedUrl = sourceUrl.trim();
  if (!normalizedUrl) {
    return;
  }

  const isSameSource = playbackState.sourceUrl === normalizedUrl;
  if (isSameSource) {
    if (audioElement.paused) {
      try {
        await audioElement.play();
      } catch {
        setPlaybackState({
          sourceUrl: normalizedUrl,
          isPlaying: false,
        });
      }
      return;
    }

    audioElement.pause();
    return;
  }

  audioElement.src = normalizedUrl;
  setPlaybackState({
    sourceUrl: normalizedUrl,
    isPlaying: false,
  });

  try {
    await audioElement.play();
  } catch {
    setPlaybackState({
      sourceUrl: normalizedUrl,
      isPlaying: false,
    });
  }
};
