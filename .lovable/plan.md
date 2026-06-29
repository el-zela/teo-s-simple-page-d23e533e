## Goal
Add full bilingual support (English + Swahili) across the entire app using `react-i18next`, with a language-picker popup shown on first visit.

## Approach

### 1. Setup i18n
- Install `i18next`, `react-i18next`, `i18next-browser-languagedetector`.
- Create `src/i18n/index.ts` that initializes i18next with two namespaces (`en`, `sw`), reads/persists choice from `localStorage` (key `nexus_lang`).
- Create `src/i18n/locales/en.json` and `src/i18n/locales/sw.json` containing all UI strings, organized by page/feature:
  - `common` (buttons, errors, statuses, currency labels)
  - `nav` (bottom-nav labels)
  - `auth` (sign in / sign up modal + login/signup pages)
  - `markets` (home/index trade panel)
  - `signals`
  - `wallet` (deposit/withdraw/redeem)
  - `account`
  - `chart`
  - `chatbot`
- Import `./i18n` once in `src/router.tsx` so it boots before any component renders (SSR-safe: initialize synchronously with bundled resources, no HTTP backend).

### 2. Language picker popup
- New `src/components/language-picker-modal.tsx`: a Dialog shown when `localStorage.getItem('nexus_lang')` is null. Two big buttons: **English** and **Kiswahili**. On select, calls `i18n.changeLanguage(lang)`, persists to localStorage, closes modal.
- Mount inside `RootComponent` in `src/routes/__root.tsx` (client-only via `useEffect` to avoid SSR mismatch).
- Add a small language toggle (EN / SW) in the account page so users can change later.

### 3. Replace hardcoded strings
Sweep these files and replace user-visible strings with `t('...')`:
- `src/components/bottom-nav.tsx`
- `src/components/auth-modal.tsx`
- `src/components/auth-gate.tsx`
- `src/components/chatbot-widget.tsx`
- `src/components/ForexChart.tsx` (labels only)
- `src/routes/index.tsx`
- `src/routes/signals.tsx`
- `src/routes/wallet.tsx`
- `src/routes/account.tsx`
- `src/routes/login.tsx`
- `src/routes/signup.tsx`
- `src/routes/chart.tsx`
- Toast messages inside the above (both English and Swahili variants come from locale files).

Mixed Swahili/English strings currently in code (e.g. "Ingia kwanza", "Weka quantity sahihi", "Fungua akaunti") move into locale files so both languages are covered.

### 4. Document title / meta
- Keep root meta in English (SEO). Do not translate `<head>` metadata; only in-app UI.

### 5. Verification
- Build runs clean.
- Visit `/` in a fresh session → popup appears.
- Choose Kiswahili → entire UI switches; reload → popup does not reappear; language persists.
- Switching from account page updates immediately.

## Technical notes
- i18next initialized with `resources` inlined (no async backend) so SSR renders the correct language on first paint after the user has chosen one (read from cookie fallback later if needed; v1 uses localStorage only, default `en` on SSR).
- `react-i18next` `useTranslation()` is used in components. For server functions, error strings remain as codes; the client maps codes → translations.
- No business logic, DB schema, or auth flow changes.

## Out of scope
- Translating server-function error messages on the server (client maps known error codes to localized strings).
- Translating data from the database (signal rationale text from AI stays in the language the model returns).
