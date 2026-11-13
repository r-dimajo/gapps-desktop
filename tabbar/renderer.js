const $ = (id) => document.getElementById(id);

let currentState = null;

function render(state) {
  if (!state) return;
  currentState = state;
  const container = $("tabs");
  container.textContent = "";

  const { tabs = [], active = null, apps = [] } = state;

  tabs.forEach((tab, index) => {
    const appDef = apps.find((a) => a.id === tab.app);
    const color = (appDef && appDef.color) || "#9aa0a6";

    const el = document.createElement("div");
    el.className = "tab" + (tab.id === active ? " active" : "");
    el.title = `${tab.title || "Scheda"} (${index + 1})`;

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.backgroundColor = color;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title || (appDef ? appDef.title : "Google");

    const closeBtn = document.createElement("button");
    closeBtn.className = "x";
    closeBtn.title = "Chiudi scheda (Ctrl+W)";
    closeBtn.innerHTML = "&#10005;";

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.gapps.closeTab(tab.id);
    });

    el.appendChild(dot);
    el.appendChild(title);
    el.appendChild(closeBtn);

    el.addEventListener("click", () => {
      window.gapps.activateTab(tab.id);
    });

    // Middle click closes tab
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.gapps.closeTab(tab.id);
      }
    });

    // Right-click native context menu
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      window.gapps.showTabMenu(tab.id);
    });

    container.appendChild(el);

    if (tab.id === active) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  });
}

// Button actions
$("new").addEventListener("click", () => window.gapps.showAppMenu());
$("reload").addEventListener("click", () => window.gapps.reloadActive());
$("gear").addEventListener("click", () => window.gapps.showSettingsMenu());

// Keyboard shortcuts within tabbar
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "t" || e.key === "T")) {
    e.preventDefault();
    window.gapps.showAppMenu();
  } else if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    if (currentState && currentState.active) {
      window.gapps.closeTab(currentState.active);
    }
  } else if (e.ctrlKey && (e.key === "r" || e.key === "R") || e.key === "F5") {
    e.preventDefault();
    window.gapps.reloadActive();
  } else if (e.ctrlKey && !e.shiftKey && (e.key === "Tab" || e.key === "PageDown")) {
    e.preventDefault();
    switchTabRelative(1);
  } else if (e.ctrlKey && (e.shiftKey && e.key === "Tab" || e.key === "PageUp")) {
    e.preventDefault();
    switchTabRelative(-1);
  } else if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key, 10) - 1;
    if (currentState && currentState.tabs && currentState.tabs[idx]) {
      e.preventDefault();
      window.gapps.activateTab(currentState.tabs[idx].id);
    }
  }
});

function switchTabRelative(offset) {
  if (!currentState || !currentState.tabs || currentState.tabs.length <= 1) return;
  const idx = currentState.tabs.findIndex((t) => t.id === currentState.active);
  if (idx === -1) return;
  const nextIdx = (idx + offset + currentState.tabs.length) % currentState.tabs.length;
  window.gapps.activateTab(currentState.tabs[nextIdx].id);
}

// Initialize
window.gapps.onState((state) => render(state));
window.gapps.getState().then((state) => render(state)).catch(console.error);
