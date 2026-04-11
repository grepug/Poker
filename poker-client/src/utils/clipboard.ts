export const fallbackCopyText = (text: string, doc?: Document) => {
  if (!doc?.body || typeof doc.execCommand !== "function") {
    return false;
  }

  const textArea = doc.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  doc.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  let copied = false;
  try {
    copied = doc.execCommand("copy");
  } finally {
    doc.body.removeChild(textArea);
  }

  return copied;
};

type ClipboardLike = {
  writeText?: (text: string) => Promise<void>;
};

export const writeTextToClipboard = async (
  text: string,
  options?: {
    clipboard?: ClipboardLike | null;
    fallbackCopy?: (value: string) => boolean;
  },
) => {
  const clipboard =
    options?.clipboard ??
    (typeof navigator !== "undefined" ? (navigator.clipboard as ClipboardLike | undefined) : undefined);
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy copy path below.
    }
  }

  const fallbackCopy = options?.fallbackCopy ?? fallbackCopyText;
  return fallbackCopy(text);
};
