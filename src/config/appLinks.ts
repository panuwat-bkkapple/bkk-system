// The standalone chat console lives on its own origin/PWA (see chat.html /
// ChatApp). The admin app links out to it instead of hosting the InboxPage —
// this is what removed the duplicate customer-chat push on the admin PWA.
// Override with VITE_CHAT_APP_URL (GitHub secret) when the custom domain
// (e.g. https://chat.bkkapple.com) is attached in the Firebase console.
export const CHAT_APP_URL =
  (import.meta.env.VITE_CHAT_APP_URL as string | undefined)?.trim() ||
  'https://bkk-apple-chat.web.app';
