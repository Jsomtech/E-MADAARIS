import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import so from './locales/so.json';

const stored = localStorage.getItem('emadaaris.lang');

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, so: { translation: so } },
  lng: stored || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('emadaaris.lang', lng);
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
