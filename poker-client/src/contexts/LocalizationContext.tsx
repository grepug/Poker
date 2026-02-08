/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { MESSAGES, SUPPORTED_LOCALES, type Locale, type MessageKey } from "../i18n/messages";

type TranslationValues = Record<string, string | number>;

type LocalizationContextType = {
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  t: (key: MessageKey, values?: TranslationValues) => string;
};

const LOCALE_STORAGE_KEY = "poker.locale";

const LocalizationContext = createContext<LocalizationContextType | null>(null);

const isSupportedLocale = (value: string): value is Locale =>
  SUPPORTED_LOCALES.includes(value as Locale);

const detectLocaleFromBrowser = (): Locale => {
  if (typeof window === "undefined") return "en";

  const languages = [window.navigator.language, ...(window.navigator.languages ?? [])]
    .filter(Boolean)
    .map((language) => language.toLowerCase());

  const isChinese = languages.some((language) => language.startsWith("zh"));
  return isChinese ? "zh_hans" : "en";
};

const resolveInitialLocale = (): Locale => {
  if (typeof window === "undefined") return "en";

  const savedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (savedLocale && isSupportedLocale(savedLocale)) {
    return savedLocale;
  }

  return detectLocaleFromBrowser();
};

const formatMessage = (template: string, values?: TranslationValues): string => {
  if (!values) return template;

  return template.replace(/\{(\w+)\}/g, (match, token) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
};

export const LocalizationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => resolveInitialLocale());

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    }
  }, []);

  const t = useCallback((key: MessageKey, values?: TranslationValues): string => {
    const localized = MESSAGES[locale][key] ?? MESSAGES.en[key] ?? key;
    return formatMessage(localized, values);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <LocalizationContext.Provider value={value}>{children}</LocalizationContext.Provider>;
};

export const useLocalization = (): LocalizationContextType => {
  const context = useContext(LocalizationContext);
  if (!context) {
    throw new Error("useLocalization must be used within LocalizationProvider");
  }
  return context;
};
