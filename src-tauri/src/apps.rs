pub struct AppDef {
    pub id: &'static str,
    pub title: &'static str,
    pub url: &'static str,
    pub host: &'static str,
}

pub const APPS: &[AppDef] = &[
    AppDef { id: "gmail",    title: "Gmail",    url: "https://mail.google.com",    host: "mail.google.com" },
    AppDef { id: "calendar", title: "Calendar", url: "https://calendar.google.com", host: "calendar.google.com" },
    AppDef { id: "drive",    title: "Drive",    url: "https://drive.google.com",   host: "drive.google.com" },
    AppDef { id: "docs",     title: "Docs",     url: "https://docs.google.com",    host: "docs.google.com" },
    AppDef { id: "sheets",   title: "Sheets",   url: "https://sheets.google.com",  host: "sheets.google.com" },
    AppDef { id: "slides",   title: "Slides",   url: "https://slides.google.com",  host: "slides.google.com" },
    AppDef { id: "meet",     title: "Meet",     url: "https://meet.google.com",    host: "meet.google.com" },
    AppDef { id: "chat",     title: "Chat",     url: "https://chat.google.com",    host: "chat.google.com" },
    AppDef { id: "keep",     title: "Keep",     url: "https://keep.google.com",    host: "keep.google.com" },
    AppDef { id: "tasks",    title: "Tasks",    url: "https://tasks.google.com",   host: "tasks.google.com" },
];

pub fn by_id(id: &str) -> Option<&'static AppDef> {
    APPS.iter().find(|a| a.id == id)
}

pub fn by_host(host: &str) -> Option<&'static AppDef> {
    APPS.iter().find(|a| host.ends_with(a.host))
}
