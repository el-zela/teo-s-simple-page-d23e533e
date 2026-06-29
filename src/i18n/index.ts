import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import sw from "./locales/sw.json";

export const LANGUAGE_STORAGE_KEY = "nexus_lang";
export type AppLanguage = "en" | "sw";

export function getStoredLanguage(): AppLanguage | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "sw") return stored;
  } catch {
    // ignore
  }
  return null;
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      sw: { translation: sw },
    },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

export function setAppLanguage(lang: AppLanguage) {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(lang);
}

export function hasChosenLanguage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return !!window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return true;
  }
}

export default i18n;
