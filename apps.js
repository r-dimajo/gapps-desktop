const APPS = [
  { id: "gmail",    title: "Gmail",    description: "Posta elettronica",            url: "https://mail.google.com",     host: "mail.google.com",     color: "#ea4335" },
  { id: "calendar", title: "Calendar", description: "Calendario e appuntamenti",      url: "https://calendar.google.com", host: "calendar.google.com", color: "#4285f4" },
  { id: "drive",    title: "Drive",    description: "Archivio cloud e file",         url: "https://drive.google.com",    host: "drive.google.com",    color: "#34a853" },
  { id: "docs",     title: "Docs",     description: "Documenti di testo",           url: "https://docs.google.com",     host: "docs.google.com",     color: "#4285f4" },
  { id: "sheets",   title: "Sheets",   description: "Fogli di calcolo",             url: "https://sheets.google.com",   host: "sheets.google.com",   color: "#0f9d58" },
  { id: "slides",   title: "Slides",   description: "Presentazioni multimediali",   url: "https://slides.google.com",   host: "slides.google.com",   color: "#f4b400" },
  { id: "meet",     title: "Meet",     description: "Videochiamate e riunioni",     url: "https://meet.google.com",     host: "meet.google.com",     color: "#00897b" },
  { id: "chat",     title: "Chat",     description: "Messaggi diretti e canali",    url: "https://chat.google.com",     host: "chat.google.com",     color: "#34a853" },
  { id: "keep",     title: "Keep",     description: "Note rapide ed elenchi",       url: "https://keep.google.com",     host: "keep.google.com",     color: "#fbbc04" },
  { id: "tasks",    title: "Tasks",    description: "Gestione attività e to-do",    url: "https://tasks.google.com",    host: "tasks.google.com",    color: "#4285f4" },
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
    for (const app of APPS) {
      if (host.endsWith(app.host)) return app;
    }
  } catch (_) {}
  return null;
}

function isInternal(urlOrHost) {
  if (!urlOrHost) return false;
  let host = urlOrHost;
  try {
    if (urlOrHost.includes("://")) {
      host = new URL(urlOrHost).hostname;
    }
  } catch (_) {}
  host = host.toLowerCase();
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "googlemail.com" ||
    host.endsWith(".googlemail.com") ||
    host.endsWith(".googleusercontent.com") ||
    host.endsWith(".gstatic.com") ||
    urlOrHost.startsWith("file://")
  );
}

module.exports = { APPS, byId, byHost, detectApp, isInternal };
