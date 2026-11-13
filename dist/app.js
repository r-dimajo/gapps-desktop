const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let S = null; // { tabs, active, settings }
let apps = [];

const $ = (id) => document.getElementById(id);

async function activate(id) {
  if (S) {
    S.active = id;
    render();
  }
  try {
    await invoke("activate_tab", { id });
  } catch (e) {
    console.error("activate_tab error:", e);
  }
}

async function close(id) {
  try {
    await invoke("close_tab", { id });
  } catch (e) {
    console.error("close_tab error:", e);
  }
}

function renderTabs() {
  const strip = $("tabs");
  strip.textContent = "";
  if (!S || !S.tabs) return;
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
      invoke("show_tab_menu", { id: t.id });
    });
    el.querySelector(".x").addEventListener("click", (e) => {
      e.stopPropagation();
      close(t.id);
    });
    strip.appendChild(el);
  }
}

function render() {
  renderTabs();
}

async function boot() {
  try {
    apps = await invoke("list_apps");
    S = await invoke("get_state");
    render();
    await listen("tabs", (e) => {
      S = e.payload;
      render();
    });
  } catch (err) {
    console.error("boot error:", err);
  }
}

$("new").addEventListener("click", () => invoke("show_app_menu"));
$("reload").addEventListener("click", () => invoke("reload_active"));
$("gear").addEventListener("click", () => invoke("show_settings_menu"));

boot();
