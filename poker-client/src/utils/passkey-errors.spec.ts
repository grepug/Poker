import { beforeEach, describe, expect, it } from "vitest";
import {
  PasskeyClientError,
  createPasskeySupportError,
  getPasskeyErrorTranslationKey,
  normalizePasskeyBrowserError,
} from "./passkey-errors";

describe("passkey-errors", () => {
  const originalNavigator = globalThis.navigator;
  const originalPublicKeyCredential = globalThis.PublicKeyCredential;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: originalPublicKeyCredential,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("maps preflight support failures to stable passkey client errors", () => {
    const error = createPasskeySupportError("embedded-context");

    expect(error).toBeInstanceOf(PasskeyClientError);
    expect(error.code).toBe("embedded-context");
    expect(getPasskeyErrorTranslationKey(error)).toBe(
      "auth.error.passkeyEmbeddedContext",
    );
  });

  it("maps browser-side not-allowed errors to an rp-id mismatch when the host differs", () => {
    const browserWindow = {};
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: class PublicKeyCredential {},
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          create() {
            return Promise.resolve(null);
          },
          get() {
            return Promise.resolve(null);
          },
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        isSecureContext: true,
        location: {
          hostname: "127.0.0.1",
          origin: "http://127.0.0.1:5174",
        },
        self: browserWindow,
        top: browserWindow,
      },
    });

    const error = normalizePasskeyBrowserError(
      Object.assign(new Error("The operation either timed out or was not allowed."), {
        name: "NotAllowedError",
      }),
      { rpId: "localhost" },
    );

    expect(error).toBeInstanceOf(PasskeyClientError);
    expect(error?.code).toBe("rp-id-mismatch");
    expect(getPasskeyErrorTranslationKey(error)).toBe(
      "auth.error.passkeyRpIdMismatch",
    );
  });

  it("maps browser-side not-allowed errors to a recoverable no-credential guidance fallback", () => {
    const browserWindow = {};
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: class PublicKeyCredential {},
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        credentials: {
          create() {
            return Promise.resolve(null);
          },
          get() {
            return Promise.resolve(null);
          },
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        isSecureContext: true,
        location: {
          hostname: "poker.example.com",
          origin: "https://poker.example.com",
        },
        self: browserWindow,
        top: browserWindow,
      },
    });

    const error = normalizePasskeyBrowserError(
      Object.assign(new Error("The operation either timed out or was not allowed."), {
        name: "NotAllowedError",
      }),
      { rpId: "poker.example.com" },
    );

    expect(error).toBeInstanceOf(PasskeyClientError);
    expect(error?.code).toBe("not-allowed");
    expect(getPasskeyErrorTranslationKey(error)).toBe(
      "auth.error.passkeyNotAllowed",
    );
  });
});
