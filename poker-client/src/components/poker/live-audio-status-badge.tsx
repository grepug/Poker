import React from "react";
import { AudioLines, Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type LiveAudioStatusBadgeKind = "speaking" | "on-mic" | "muted";

type LiveAudioStatusBadgeProps = {
  kind: LiveAudioStatusBadgeKind;
  className?: string;
  testId?: string;
  ariaLabel?: string;
  title?: string;
};

export const LiveAudioStatusBadge: React.FC<LiveAudioStatusBadgeProps> = ({
  kind,
  className,
  testId,
  ariaLabel,
  title,
}) => (
  <span
    className={cn(
      "live-audio-status-badge",
      `live-audio-status-badge--${kind}`,
      className,
    )}
    data-testid={testId}
    aria-label={ariaLabel}
    title={title ?? ariaLabel}
    aria-hidden={ariaLabel ? undefined : true}
  >
    {kind === "speaking" ? (
      <AudioLines size={10} strokeWidth={2.4} aria-hidden="true" />
    ) : kind === "muted" ? (
      <MicOff size={10} strokeWidth={2.4} aria-hidden="true" />
    ) : (
      <Mic size={10} strokeWidth={2.4} aria-hidden="true" />
    )}
  </span>
);
