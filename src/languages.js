export const languages = [
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'zh', name: 'Chinese', native: '中文' }
];
export const language = code => languages.find(l => l.code === code);
