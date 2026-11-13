// Official Google Workspace Vector SVGs & UI Icons
const ICONS = {
  gmail: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M2.5 19.5h3.5V11L2 8.5v9a2 2 0 0 0 .5 2z"/><path fill="#34A853" d="M18 19.5h3.5a2 2 0 0 0 .5-2v-9L18 11v8.5z"/><path fill="#EA4335" d="M18 7.5V11l4-2.5-4-1zM2 8.5 6 11V7.5L2 8.5z"/><path fill="#EA4335" d="M6 7.5V11l6 4.5 6-4.5V7.5L12 3z"/><path fill="#FBBC04" d="m18 7.5-6-4.5-6 4.5v.5l6 4.5 6-4.5z"/></svg>`,

  calendar: `<svg viewBox="0 0 24 24" width="100%" height="100%"><rect width="18" height="18" x="3" y="3" rx="3" fill="#FFF"/><path fill="#1A73E8" d="M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3z"/><path fill="#FFF" d="M6 7h12v11H6z"/><path fill="#EA4335" d="M8 5h2v4H8zM14 5h2v4h-2z"/><path fill="#1A73E8" d="M9 11h2v2H9zM13 11h2v2h-2zM9 14h2v2H9zM13 14h2v2h-2z"/></svg>`,

  drive: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#FFC107" d="M8.2 3.5 2.5 13.5h5.8l5.7-10z"/><path fill="#4CAF50" d="m8.3 13.5-3.3 5.8a2 2 0 0 0 1.7 1.2h12.6l-5.8-10z"/><path fill="#2196F3" d="m14 3.5-5.7 10h11.5l3.3-5.8a2 2 0 0 0-1.7-1.2h-7.4z"/></svg>`,

  docs: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path fill="#A1C2FA" d="M14 2v6h6L14 2z"/><path fill="#FFF" d="M7 11h10v1.5H7zM7 14h10v1.5H7zM7 17h6v1.5H7z"/></svg>`,

  sheets: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#0F9D58" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path fill="#87CEAC" d="M14 2v6h6L14 2z"/><path fill="#FFF" d="M7 10h10v8H7zm2 2v1.5h2.5V12zm0 2.5v1.5h2.5V14.5zm3.5-2.5v1.5H15V12zm0 2.5v1.5H15V14.5z"/></svg>`,

  slides: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#F4B400" d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path fill="#FBE7A1" d="M14 2v6h6L14 2z"/><path fill="#FFF" d="M7 11h10v7H7zm1.5 1.5v4h7v-4z"/></svg>`,

  meet: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#00832D" d="M14 10.5V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-4.5l4 3.5V7z"/><path fill="#0066DA" d="M18 7v10l3.5 2.5a1 1 0 0 0 1.5-.9V5.4a1 1 0 0 0-1.5-.9z"/><path fill="#E37400" d="M14 6h-4v6h4z"/><path fill="#FFBA00" d="M10 6H4a2 2 0 0 0-2 2v2h8z"/></svg>`,

  chat: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#00AC47" d="M19 2H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h2v3.5a.5.5 0 0 0 .8.4L12 18h7a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z"/><path fill="#FFF" d="M6 7h12v1.8H6zm0 3.2h8V12H6z"/></svg>`,

  keep: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#FFBB00" d="M9 21h6v-1.5H9zm3-19a7 7 0 0 0-4.9 12c.7.7 1.2 1.6 1.4 2.5h7c.2-.9.7-1.8 1.4-2.5A7 7 0 0 0 12 2z"/><path fill="#FFF" d="M12 4a5 5 0 0 0-3.5 8.5l.5.5c.6.6 1 1.4 1.2 2.2h3.6c.2-.8.6-1.6 1.2-2.2l.5-.5A5 5 0 0 0 12 4z"/><path fill="#FFD043" d="M10 17.5h4v1.5h-4z"/></svg>`,

  tasks: `<svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="12" r="10" fill="#1A73E8"/><path fill="#FFF" d="m10 15.5-3.5-3.5 1.4-1.4 2.1 2.1 5.6-5.6 1.4 1.4z"/><circle cx="17.5" cy="6.5" r="3" fill="#FBBC04"/><path fill="#EA4335" d="M17.5 4.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>`,

  newtab: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="#4285F4" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>`,

  pin: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,

  audio: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z"/></svg>`,

  muted: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.5 2.5c0-.2 0-.5 0-.7zm2.5 0c0 .9-.2 1.8-.5 2.6l1.5 1.5c.7-1.2 1-2.6 1-4.1 0-4.3-3-7.9-7-8.8v2.1c2.9.9 5 3.5 5 6.7zM4.3 3 3 4.3l4 4H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.1v2.1c1.4-.3 2.6-.9 3.7-1.8l2 2 1.3-1.3L4.3 3zM12 4 9.9 6.1 12 8.2V4z"/></svg>`
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ICONS };
}
