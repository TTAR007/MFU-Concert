// src/LanguageProvider.jsx
// This file exports ONLY a React component, which keeps it fully compatible
// with React Fast Refresh (mixing component + non-component exports in one
// file is what breaks hot-swapping — see src/i18n.js for the data/logic side).
import { useState, useCallback } from 'react';
import { LanguageContext, translations, LANG_STORAGE_KEY } from './i18n';

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) || 'th';
    } catch {
      return 'th';
    }
  });

  const setLang = useCallback((newLang) => {
    setLangState(newLang);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, newLang);
    } catch {
      /* localStorage unavailable — language just won't persist across reloads */
    }
  }, []);

  const t = useCallback(
    (key, ...args) => {
      const entry = translations[lang]?.[key] ?? translations.en[key] ?? key;
      return typeof entry === 'function' ? entry(...args) : entry;
    },
    [lang]
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}