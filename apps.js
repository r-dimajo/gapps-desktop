const APPS = [
  { id: "gmail",    title: "Gmail",    description: "Email and messaging",          url: "https://mail.google.com",     host: "mail.google.com",     color: "#ea4335" },
  { id: "calendar", title: "Calendar", description: "Calendar and scheduling",     url: "https://calendar.google.com", host: "calendar.google.com", color: "#4285f4" },
  { id: "drive",    title: "Drive",    description: "Cloud storage and files",     url: "https://drive.google.com",    host: "drive.google.com",    color: "#34a853" },
  { id: "docs",     title: "Docs",     description: "Documents and word processor",url: "https://docs.google.com",     host: "docs.google.com",     color: "#4285f4" },
  { id: "sheets",   title: "Sheets",   description: "Spreadsheets and data",       url: "https://sheets.google.com",   host: "sheets.google.com",   color: "#0f9d58" },
  { id: "slides",   title: "Slides",   description: "Presentations and slides",    url: "https://slides.google.com",   host: "slides.google.com",   color: "#f4b400" },
  { id: "forms",    title: "Forms",    description: "Online forms and surveys",    url: "https://forms.google.com",    host: "forms.google.com",    color: "#7248b9" },
  { id: "meet",     title: "Meet",     description: "Video meetings and calls",    url: "https://meet.google.com",     host: "meet.google.com",     color: "#00897b" },
  { id: "chat",     title: "Chat",     description: "Direct messages and spaces",  url: "https://chat.google.com",     host: "chat.google.com",     color: "#34a853" },
  { id: "gemini",   title: "Gemini",   description: "Conversational AI assistant", url: "https://gemini.google.com",   host: "gemini.google.com",   color: "#8ab4f8" },
  { id: "keep",     title: "Keep",     description: "Quick notes and lists",       url: "https://keep.google.com",     host: "keep.google.com",     color: "#fbbc04" },
  { id: "tasks",    title: "Tasks",    description: "Task management and to-dos",  url: "https://tasks.google.com",    host: "tasks.google.com",    color: "#4285f4" },
  { id: "translate",title: "Translate",description: "Language translation",        url: "https://translate.google.com",host: "translate.google.com",color: "#4285f4" },
];

function byId(id) {
  return APPS.find((a) => a.id === id);
}

function byHost(host) {
  if (!host) return null;
  const clean = host.toLowerCase();
  return APPS.find((a) => clean.endsWith(a.host));
}

function detectApp(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();

    // Google Workspace sub-apps hosted on docs.google.com or distinct domains
    if (
      host === 'forms.gle' ||
      host === 'forms.google.com' ||
      (host === 'docs.google.com' && pathname.startsWith('/forms')) ||
      (host === 'goo.gl' && pathname.startsWith('/forms'))
    ) {
      return byId('forms') || null;
    }

    if (
      host === 'slides.google.com' ||
      (host === 'docs.google.com' && pathname.startsWith('/presentation'))
    ) {
      return byId('slides') || null;
    }

    if (
      host === 'sheets.google.com' ||
      (host === 'docs.google.com' && pathname.startsWith('/spreadsheets'))
    ) {
      return byId('sheets') || null;
    }

    if (
      host === 'docs.google.com' &&
      (pathname.startsWith('/document') || pathname === '' || pathname === '/' || pathname.startsWith('/u/'))
    ) {
      return byId('docs') || null;
    }

    for (const app of APPS) {
      if (['forms', 'slides', 'sheets', 'docs'].includes(app.id)) continue;
      if (host.endsWith(app.host)) return app;
    }
  } catch (_) {}
  return null;
}

function unwrapGoogleUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    if (!url.includes('://')) return url;
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isGoogleHost =
      host === 'google.com' ||
      host.endsWith('.google.com') ||
      host === 'googleadservices.com' ||
      host.endsWith('.googleadservices.com') ||
      host.includes('doubleclick.net');

    if (isGoogleHost) {
      if (u.pathname === '/url') {
        const target = u.searchParams.get('q') || u.searchParams.get('url');
        if (target) return unwrapGoogleUrl(target);
      }
      const adUrl = u.searchParams.get('adurl');
      if (adUrl) return unwrapGoogleUrl(adUrl);
    }
  } catch (_) {}
  return url;
}

function isInternal(urlOrHost) {
  if (!urlOrHost) return false;
  let target = urlOrHost;
  try {
    target = unwrapGoogleUrl(urlOrHost);
  } catch (_) {}

  let host = target;
  let pathname = '';
  try {
    if (target.includes('://')) {
      const parsed = new URL(target);
      host = parsed.hostname;
      pathname = parsed.pathname;
    }
  } catch (_) {}
  host = host.toLowerCase();
  return (
    host === 'google.com' ||
    host.endsWith('.google.com') ||
    host === 'googlemail.com' ||
    host.endsWith('.googlemail.com') ||
    host.endsWith('.googleusercontent.com') ||
    host.endsWith('.gstatic.com') ||
    host === 'forms.gle' ||
    host === 'g.co' ||
    (host === 'goo.gl' && pathname.startsWith('/forms')) ||
    target.startsWith('file://')
  );
}

module.exports = { APPS, byId, byHost, detectApp, isInternal, unwrapGoogleUrl };
