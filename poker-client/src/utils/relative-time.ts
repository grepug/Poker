import type { Locale } from "../i18n/messages";

const localeTagMap: Record<Locale, string> = {
  en: "en",
  zh_hans: "zh-Hans",
};

const formatterCache = new Map<string, Intl.RelativeTimeFormat>();

const getFormatter = (locale: Locale): Intl.RelativeTimeFormat => {
  const tag = localeTagMap[locale] ?? "en";
  const cached = formatterCache.get(tag);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.RelativeTimeFormat(tag, {
    numeric: "auto",
  });
  formatterCache.set(tag, formatter);
  return formatter;
};

export const formatRelativeTime = (
  timestamp: number,
  locale: Locale,
  now: number = Date.now(),
): string => {
  const deltaSeconds = Math.round((timestamp - now) / 1000);
  const absoluteDelta = Math.abs(deltaSeconds);

  let value = deltaSeconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";

  if (absoluteDelta >= 45 && absoluteDelta < 45 * 60) {
    value = Math.round(deltaSeconds / 60);
    unit = "minute";
  } else if (absoluteDelta >= 45 * 60 && absoluteDelta < 22 * 60 * 60) {
    value = Math.round(deltaSeconds / 3600);
    unit = "hour";
  } else if (absoluteDelta >= 22 * 60 * 60) {
    value = Math.round(deltaSeconds / 86400);
    unit = "day";
  }

  return getFormatter(locale).format(value, unit);
};
