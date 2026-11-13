const $ = (id) => document.getElementById(id);

let currentState = null;
let draggedTabId = null;

function clearDropIndicators() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.remove("drop-before", "drop-after");
  });
}

function render(state) {
  if (!state) return;
  currentState = state;
  const container = $("tabs");
  container.textContent = "";

  const { tabs = [], active = null, apps = [] } = state;

  tabs.forEach((tab, index) => {
    const appDef = apps.find((a) => a.id === tab.app);

    const el = document.createElement("div");
    el.className = "tab" + (tab.id === active ? " active" : "") + (tab.pinned ? " pinned" : "");
    el.title = `${tab.title || "Scheda"} (${index + 1})${tab.pinned ? " [Fissata]" : ""}`;
    el.dataset.id = tab.id;

    // Drag and drop reordering
    el.setAttribute("draggable", "true");

    el.addEventListener("dragstart", (e) => {
      draggedTabId = tab.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tab.id);
      setTimeout(() => el.classList.add("dragging"), 0);
    });

    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (!draggedTabId || draggedTabId === tab.id) return;
      const rect = el.getBoundingClientRect();
      const dropAfter = (e.clientX - rect.left) > rect.width / 2;
      clearDropIndicators();
      el.classList.add(dropAfter ? "drop-after" : "drop-before");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("drop-before", "drop-after");
    });

    el.addEventListener("drop", (e) => {
      e.preventDefault();
      clearDropIndicators();
      if (!draggedTabId || draggedTabId === tab.id) return;
      const rect = el.getBoundingClientRect();
      const dropAfter = (e.clientX - rect.left) > rect.width / 2;
      window.gapps.moveTab(draggedTabId, tab.id, dropAfter);
      draggedTabId = null;
    });

    el.addEventListener("dragend", () => {
      draggedTabId = null;
      clearDropIndicators();
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("dragging"));
    });

    // App SVG Icon (switches to badged icon with red dot if there are unread notifications)
    const iconContainer = document.createElement("div");
    iconContainer.className = "tab-icon";
    const hasUnread = Boolean(tab.unreadCount && tab.unreadCount > 0);
    const iconKey = hasUnread && typeof ICONS !== "undefined" && ICONS[tab.app + "_badged"]
      ? tab.app + "_badged"
      : tab.app;
    const iconSvg =
      (typeof ICONS !== "undefined" && (ICONS[iconKey] || ICONS[tab.app] || ICONS.newtab)) || "";
    iconContainer.innerHTML = iconSvg;
    el.appendChild(iconContainer);

    // Title
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title || (appDef ? appDef.title : "Nuova scheda");
    el.appendChild(title);

    // Unread count badge
    if (tab.unreadCount && tab.unreadCount > 0) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = tab.unreadCount > 99 ? "99+" : tab.unreadCount;
      el.appendChild(badge);
    }

    // Audio / Mute indicator
    if (tab.isAudible) {
      const audioBtn = document.createElement("button");
      audioBtn.className = "audio-btn";
      audioBtn.title = tab.isMuted ? "Riattiva audio scheda" : "Disattiva audio scheda";
      audioBtn.innerHTML = typeof ICONS !== "undefined" ? (tab.isMuted ? ICONS.muted : ICONS.audio) : "🔊";
      audioBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.gapps.toggleMuteTab(tab.id);
      });
      el.appendChild(audioBtn);
    }

    // Close button (only for non-pinned tabs)
    if (!tab.pinned) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "x";
      closeBtn.title = "Chiudi scheda (Ctrl+W)";
      closeBtn.innerHTML = "&#10005;";
      closeBtn.setAttribute("draggable", "false");

      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.gapps.closeTab(tab.id);
      });
      el.appendChild(closeBtn);
    }

    el.addEventListener("click", () => {
      window.gapps.activateTab(tab.id);
    });

    // Middle click closes tab (if not pinned)
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1 && !tab.pinned) {
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

// Container drop for moving to end
const tabsContainer = $("tabs");
tabsContainer.addEventListener("dragover", (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
});

tabsContainer.addEventListener("drop", (e) => {
  if (e.target === tabsContainer && draggedTabId) {
    e.preventDefault();
    clearDropIndicators();
    window.gapps.moveTabToEnd(draggedTabId);
    draggedTabId = null;
  }
});

// Button actions: "+" opens the New Tab Grid page!
$("new").addEventListener("click", () => window.gapps.openNewTab());
$("new").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.gapps.showAppMenu();
});
$("reload").addEventListener("click", () => window.gapps.reloadActive());
$("gear").addEventListener("click", () => window.gapps.showSettingsMenu());

// Keyboard shortcuts within tabbar
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey && (e.key === "t" || e.key === "T")) {
    e.preventDefault();
    window.gapps.openNewTab();
  } else if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    if (currentState && currentState.active) {
      const current = currentState.tabs.find((t) => t.id === currentState.active);
      if (current && !current.pinned) {
        window.gapps.closeTab(currentState.active);
      }
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
