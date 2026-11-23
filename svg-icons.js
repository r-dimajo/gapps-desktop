// Generic UI glyphs (Material Design icons style). Google product logos are NOT
// bundled: the app fetches them at runtime (see app icon cache in main.js).
const ICONS = {
  newtab: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>`,

  pin: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,

  lock: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,

  audio: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.5 7-8.8s-3-7.9-7-8.8z"/></svg>`,

  muted: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M16.5 12c0-1.8-1-3.3-2.5-4v2.2l2.5 2.5c0-.2 0-.5 0-.7zm2.5 0c0 .9-.2 1.8-.5 2.6l1.5 1.5c.7-1.2 1-2.6 1-4.1 0-4.3-3-7.9-7-8.8v2.1c2.9.9 5 3.5 5 6.7zM4.3 3 3 4.3l4 4H3v6h4l5 5v-6.7l4.3 4.3c-.7.5-1.4.9-2.3 1.1v2.1c1.4-.3 2.6-.9 3.7-1.8l2 2 1.3-1.3L4.3 3zM12 4 9.9 6.1 12 8.2V4z"/></svg>`,

  layoutVertical: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H9V5h10v14zM5 5h2v14H5V5z"/></svg>`,

  layoutHorizontal: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V9h14v10zm0-12H5V5h14v2z"/></svg>`,

  splitRight: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-8 16H5V5h6v14zm8 0h-6V5h6v14z"/></svg>`,

  splitDown: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 8H5V5h14v6zm0 8H5v-6h14v6z"/></svg>`,

  splitClose: `<svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ICONS };
}
