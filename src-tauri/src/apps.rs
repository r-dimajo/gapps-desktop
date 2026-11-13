pub struct AppDef {
    pub id: &'static str,
    pub title: &'static str,
    pub url: &'static str,
    pub host: &'static str,
    pub color: &'static str,
}

pub const APPS: &[AppDef] = &[
    AppDef { id: "gmail",    title: "Gmail",    url: "https://mail.google.com",     host: "mail.google.com",     color: "#ea4335" },
    AppDef { id: "calendar", title: "Calendar", url: "https://calendar.google.com", host: "calendar.google.com", color: "#4285f4" },
    AppDef { id: "drive",    title: "Drive",    url: "https://drive.google.com",    host: "drive.google.com",    color: "#34a853" },
    AppDef { id: "docs",     title: "Docs",     url: "https://docs.google.com",     host: "docs.google.com",     color: "#4285f4" },
    AppDef { id: "sheets",   title: "Sheets",   url: "https://sheets.google.com",   host: "sheets.google.com",   color: "#0f9d58" },
    AppDef { id: "slides",   title: "Slides",   url: "https://slides.google.com",   host: "slides.google.com",   color: "#f4b400" },
    AppDef { id: "meet",     title: "Meet",     url: "https://meet.google.com",     host: "meet.google.com",     color: "#00897b" },
    AppDef { id: "chat",     title: "Chat",     url: "https://chat.google.com",     host: "chat.google.com",     color: "#34a853" },
    AppDef { id: "keep",     title: "Keep",     url: "https://keep.google.com",     host: "keep.google.com",     color: "#fbbc04" },
    AppDef { id: "tasks",    title: "Tasks",    url: "https://tasks.google.com",    host: "tasks.google.com",    color: "#4285f4" },
];

pub fn by_id(id: &str) -> Option<&'static AppDef> {
    APPS.iter().find(|a| a.id == id)
}

pub fn by_host(host: &str) -> Option<&'static AppDef> {
    APPS.iter().find(|a| host.ends_with(a.host))
}

// hosts that must never leave the shell (target=_blank / top-level nav)
pub fn is_internal(host: &str) -> bool {
    host == "google.com"
        || host.ends_with(".google.com")
        || host.ends_with(".googlemail.com")
        || host.ends_with(".googleusercontent.com")
        || host.ends_with(".gstatic.com")
}
