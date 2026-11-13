const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let S = null; // { tabs, active, settings }
let apps = [];

const $ = (id) => document.getElementById(id);

function closePopups(except) {
  for (const p of ["appmenu", "ctx"]) {
    if (p !== except) $(p).classList.add("hidden");
  }
}

async function activate(id) {
  closePopups();
  await invoke("activate_tab", { id });
}

async function close(id) {
  closePopups();
  await invoke("close_tab", { id });
}

function renderTabs() {
  const strip = $("tabs");
  strip.textContent = "";
  for (const t of S.tabs) {
    const def = apps.find((a) => a.id === t.app);
    const el = document.createElement("div");
    el.className = "tab" + (t.id === S.active ? " active" : "");
    el.innerHTML = `<span class="dot" style="background:${def ? def.color : "#9aa0a6"}"></span>
      <span class="title"></span>
      <button class="x" title="Close">&#10005;</button>`;
    el.querySelector(".title").textContent = t.title;
    el.addEventListener("click", () => activate(t.id));
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) close(t.id);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      closePopups();
      const ctx = $("ctx");
      ctx.dataset.tabId = t.id;
      ctx.style.left = Math.min(e.clientX, window.innerWidth - 170) + "px";
      ctx.style.top = "40px";
      ctx.classList.remove("hidden");
    });
    el.querySelector(".x").addEventListener("click", (e) => {
      e.stopPropagation();
      close(t.id);
    });
    strip.appendChild(el);
  }
}

function renderAppMenu() {
  const m = $("appmenu");
  m.textContent = "";
  for (const a of apps) {
    const el = document.createElement("div");
    el.className = "app-item";
    el.innerHTML = `<span class="dot" style="background:${a.color}"></span><span></span>`;
    el.querySelector("span:last-child").textContent = a.title;
    el.addEventListener("click", () => {
      closePopups();
      invoke("open_tab", { appId: a.id });
    });
    m.appendChild(el);
  }
}

function renderSettings() {
  $("set-autostart").checked = S.settings.open_at_startup;
  $("set-minimized").checked = S.settings.start_minimized;
}

function render() {
  if (!S) return;
  renderTabs();
  renderSettings();
}

async function boot() {
  apps = await invoke("list_apps");
  renderAppMenu();
  S = await invoke("get_state");
  render();
  await listen("tabs", (e) => {
    S = e.payload;
    render();
  });
}

$("new").addEventListener("click", (e) => {
  closePopups();
  const m = $("appmenu");
  m.style.left = e.currentTarget.getBoundingClientRect().left + "px";
  m.style.top = "40px";
  m.classList.remove("hidden");
});

$("reload").addEventListener("click", () => invoke("reload_active"));

$("gear").addEventListener("click", () => {
  closePopups();
  $("settings").classList.toggle("hidden");
});

$("settings-close").addEventListener("click", () =>
  $("settings").classList.add("hidden")
);

$("set-autostart").addEventListener("change", (e) =>
  invoke("set_settings", { openAtStartup: e.target.checked })
);

$("set-minimized").addEventListener("change", (e) =>
  invoke("set_settings", { startMinimized: e.target.checked })
);

$("clear-cache").addEventListener("click", async () => {
  await invoke("clear_cache");
  $("cache-msg").textContent = "Cache cleared";
  setTimeout(() => ($("cache-msg").textContent = ""), 2500);
});

$("ctx-browser").addEventListener("click", async () => {
  const id = Number($("ctx").dataset.tabId);
  closePopups();
  await invoke("open_in_browser", { id });
});

$("ctx-close").addEventListener("click", () => {
  close(Number($("ctx").dataset.tabId));
});

document.addEventListener("mousedown", (e) => {
  if (!e.target.closest(".popup") && !e.target.closest("#new") &&
      !e.target.closest("#gear") && !e.target.closest("#settings"))
    closePopups();
});

boot();
