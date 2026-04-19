import {
  getPasskeySupportState,
  isHostnameCompatibleWithRpId,
  type PasskeySupportIssue,
} from "./browser-detection";

export type PasskeyClientErrorCode =
  | PasskeySupportIssue
  | "rp-id-mismatch"
  | "not-allowed"
  | "unknown-browser-error";

export class PasskeyClientError extends Error {
  readonly code: PasskeyClientErrorCode;
  readonly details: Record<string, string>;

  constructor(code: PasskeyClientErrorCode, details: Record<string, string> = {}) {
    super(code);
    this.code = code;
    this.details = details;
    this.name = "PasskeyClientError";
  }
}

const isNotAllowedLikeError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedName = error.name.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();

  return (
    normalizedName.includes("notallowed") ||
    normalizedMessage.includes("timed out or was not allowed") ||
    normalizedMessage.includes("not allowed")
  );
};

export const createPasskeySupportError = (
  issue: PasskeySupportIssue | null,
) => {
  switch (issue) {
    case "insecure-context":
    case "embedded-context":
    case "missing-public-key-credential":
    case "missing-credentials-api":
      return new PasskeyClientError(issue);
    default:
      return new PasskeyClientError("unknown-browser-error");
  }
};

export const extractPasskeyRpId = (options: unknown): string | null => {
  if (!options || typeof options !== "object") {
    return null;
  }

  const candidate = options as {
    rpId?: unknown;
    rp?: {
      id?: unknown;
    };
  };

  if (typeof candidate.rpId === "string" && candidate.rpId.trim()) {
    return candidate.rpId.trim();
  }

  if (typeof candidate.rp?.id === "string" && candidate.rp.id.trim()) {
    return candidate.rp.id.trim();
  }

  return null;
};

export const normalizePasskeyBrowserError = (
  error: unknown,
  context: {
    rpId?: string | null;
  } = {},
): PasskeyClientError | null => {
  const supportState = getPasskeySupportState();
  if (!supportState.supported) {
    return createPasskeySupportError(supportState.issue);
  }

  const currentHostname =
    typeof window !== "undefined" ? window.location.hostname : "";
  const rpId = context.rpId?.trim();

  if (
    rpId &&
    currentHostname &&
    !isHostnameCompatibleWithRpId(currentHostname, rpId)
  ) {
    return new PasskeyClientError("rp-id-mismatch", {
      currentHostname,
      rpId,
    });
  }

  if (isNotAllowedLikeError(error)) {
    return new PasskeyClientError("not-allowed", {
      rpId: rpId || "",
      currentOrigin:
        typeof window !== "undefined" ? window.location.origin : "",
    });
  }

  if (error instanceof Error) {
    return new PasskeyClientError("unknown-browser-error", {
      name: error.name,
    });
  }

  return null;
};

export const getPasskeyErrorTranslationKey = (error: unknown) => {
  if (!(error instanceof PasskeyClientError)) {
    return null;
  }

  switch (error.code) {
    case "insecure-context":
      return "auth.error.passkeyInsecureContext";
    case "embedded-context":
      return "auth.error.passkeyEmbeddedContext";
    case "missing-public-key-credential":
    case "missing-credentials-api":
      return "auth.passkeyUnsupported";
    case "rp-id-mismatch":
      return "auth.error.passkeyRpIdMismatch";
    case "not-allowed":
      return "auth.error.passkeyNotAllowed";
    case "unknown-browser-error":
    default:
      return "auth.error.passkeyUnknownBrowserFailure";
  }
};
