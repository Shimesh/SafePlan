/**
 * i18n/index.ts
 *
 * Initialises react-i18next with four supported languages:
 *   he  – Hebrew  (DEFAULT, Right-to-Left)
 *   en  – English (Left-to-Right)
 *   ru  – Russian (Left-to-Right)
 *   ar  – Arabic  (Right-to-Left)
 *
 * RTL layout switching is handled in App.tsx using React Native's
 * I18nManager.forceRTL() after this module initialises. The switch requires
 * an app restart (handled with expo-updates / RNRestart in production).
 *
 * Import this file ONCE at the top of App.tsx via:
 *   import './src/i18n';
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import he from './locales/he.json';
import en from './locales/en.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';

// ─── Supported languages and their RTL flag ────────────────────────────────
export const SUPPORTED_LANGUAGES = [
  { code: 'he', name: 'עברית',    isRTL: true  },
  { code: 'en', name: 'English',  isRTL: false },
  { code: 'ru', name: 'Русский',  isRTL: false },
  { code: 'ar', name: 'العربية', isRTL: true  },
] as const;

export type SupportedLang = typeof SUPPORTED_LANGUAGES[number]['code'];

export const RTL_LANGUAGES: SupportedLang[] = ['he', 'ar'];

// ─── Auto-detect device language, fall back to Hebrew ─────────────────────
function detectInitialLanguage(): SupportedLang {
  try {
    const deviceLocale = getLocales()[0]?.languageCode ?? 'he';
    const supported = SUPPORTED_LANGUAGES.map((l) => l.code);
    return (supported.includes(deviceLocale as SupportedLang)
      ? deviceLocale
      : 'he') as SupportedLang;
  } catch {
    return 'he';
  }
}

// ─── i18n initialisation ──────────────────────────────────────────────────
i18n
  .use(initReactI18next)
  .init({
    resources: {
      he: { translation: he },
      en: { translation: en },
      ru: { translation: ru },
      ar: { translation: ar },
    },
    lng: detectInitialLanguage(), // detected or 'he'
    fallbackLng: 'he',            // always fall back to Hebrew
    interpolation: {
      escapeValue: false,         // React handles XSS escaping
    },
    // compatibilityJSON is intentionally omitted: our locale files are plain
    // nested objects which i18next v23 handles natively without any compat shim.
  });

export default i18n;
