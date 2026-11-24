const $ = (id) => document.getElementById(id);

let currentState = null;
let draggedTabId = null;
// Service logos (data URLs) fetched at runtime by the main process
let appIcons = {};

window.gapps.getAppIcons().then((icons) => {
  appIcons = icons || {};
  if (currentState) render(currentState);
}).catch(() => {});
window.gapps.onAppIcons((icons) => {
  appIcons = icons || {};
  if (currentState) render(currentState);
});

function clearDropIndicators() {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.remove("drop-before", "drop-after");
  });
}

function render(state) {
  if (!state) return;
  currentState = state;

  const isVertical = state.layout === "vertical";
  document.documentElement.classList.toggle("vertical", isVertical);
  document.body.classList.toggle("vertical", isVertical);

  const theme = state.theme || "kde";
  document.documentElement.classList.toggle("theme-gnome", theme === "gnome");
  document.documentElement.classList.toggle("theme-kde", theme === "kde");
  document.body.classList.toggle("theme-gnome", theme === "gnome");
  document.body.classList.toggle("theme-kde", theme === "kde");

  // Set toggle buttons & brand icons from SVG definitions
  const topToggle = $("toggle-layout-top");
  if (topToggle && typeof ICONS !== "undefined" && ICONS.layoutHorizontal) {
    topToggle.innerHTML = ICONS.layoutHorizontal;
  }
  const stripToggle = $("toggle-layout-strip");
  if (stripToggle && typeof ICONS !== "undefined" && ICONS.layoutVertical) {
    stripToggle.innerHTML = ICONS.layoutVertical;
  }
  const brandIconEl = document.querySelector(".brand-icon");
  if (brandIconEl && !brandIconEl.firstChild) {
    const logo = document.createElement("img");
    logo.src = "../icons/app-icon.svg";
    logo.alt = "";
    brandIconEl.appendChild(logo);
  }

  const splitBtn = $("split-btn");
  if (splitBtn && typeof ICONS !== "undefined") {
    const isSplit = Boolean(state.split && state.split.enabled && state.split.tabId);
    if (isSplit) {
      splitBtn.innerHTML = ICONS.splitClose;
      splitBtn.title = "Close split view (Alt+Shift+S)";
      splitBtn.classList.add("active");
    } else {
      splitBtn.innerHTML = ICONS.splitRight;
      splitBtn.title = "Split view multiplexer (Alt+Shift+S)";
      splitBtn.classList.remove("active");
    }
  }

  const container = $("tabs");
  container.textContent = "";

  const { tabs = [], active = null, apps = [] } = state;

  // Update URL bar for active tab
  const activeTab = tabs.find((t) => t.id === active);
  const urlBar = $("url-bar");
  const urlText = $("url-text");
  if (urlBar && urlText) {
    if (activeTab && activeTab.url && !activeTab.url.startsWith("file://")) {
      urlBar.style.display = "flex";
      urlText.textContent = activeTab.url;
      urlBar.title = `Current URL: ${activeTab.url}`;
    } else {
      urlBar.style.display = "none";
      urlText.textContent = "";
    }
  }

  tabs.forEach((tab, index) => {
    const appDef = apps.find((a) => a.id === tab.app);

    const el = document.createElement("div");
    const hasCustomTitle = Boolean(tab.customTitle);
    const isSplitSec = Boolean(state.split && state.split.enabled && state.split.tabId === tab.id);
    el.className = "tab" +
      (tab.id === active ? " active" : "") +
      (isSplitSec ? " split-active" : "") +
      (tab.pinned ? " pinned" : "") +
      (tab.locked ? " locked" : "") +
      (hasCustomTitle ? " has-custom-title" : "");
    el.title = `${tab.title || "Tab"} (${index + 1})${isSplitSec ? " [Split View]" : ""}${tab.locked ? " [Locked]" : ""}${tab.pinned ? " [Pinned]" : ""}${tab.url ? " — " + tab.url : ""}`;
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
      const dropAfter = isVertical
        ? (e.clientY - rect.top) > rect.height / 2
        : (e.clientX - rect.left) > rect.width / 2;
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
      const dropAfter = isVertical
        ? (e.clientY - rect.top) > rect.height / 2
        : (e.clientX - rect.left) > rect.width / 2;
      window.gapps.moveTab(draggedTabId, tab.id, dropAfter);
      draggedTabId = null;
    });

    el.addEventListener("dragend", () => {
      draggedTabId = null;
      clearDropIndicators();
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("dragging"));
    });

    // Service logo (runtime-fetched) with a red dot when there is something unread
    const iconContainer = document.createElement("div");
    iconContainer.className = "tab-icon";
    const hasUnread = Boolean((tab.unreadCount && tab.unreadCount > 0) || tab.hasNotification);
    if (appIcons[tab.app]) {
      const img = document.createElement("img");
      img.src = appIcons[tab.app];
      img.alt = "";
      img.draggable = false;
      iconContainer.appendChild(img);
    } else {
      iconContainer.innerHTML = (typeof ICONS !== "undefined" && ICONS.newtab) || "";
    }
    iconContainer.classList.toggle("has-dot", hasUnread);
    el.appendChild(iconContainer);

    // Title
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = tab.title || (appDef ? appDef.title : "New Tab");
    el.appendChild(title);

    // Unread count badge / dot
    if (hasUnread) {
      const badge = document.createElement("span");
      badge.className = "badge";
      if (tab.unreadCount && tab.unreadCount > 0) {
        badge.textContent = tab.unreadCount > 99 ? "99+" : tab.unreadCount;
      } else {
        badge.classList.add("badge-dot");
      }
      el.appendChild(badge);
    }

    // Audio / Mute indicator
    if (tab.isAudible) {
      const audioBtn = document.createElement("button");
      audioBtn.className = "audio-btn";
      audioBtn.title = tab.isMuted ? "Unmute tab audio" : "Mute tab audio";
      audioBtn.innerHTML = typeof ICONS !== "undefined" ? (tab.isMuted ? ICONS.muted : ICONS.audio) : "🔊";
      audioBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.gapps.toggleMuteTab(tab.id);
      });
      el.appendChild(audioBtn);
    }

    // Lock indicator or Close button
    if (tab.locked) {
      const lockBtn = document.createElement("button");
      lockBtn.className = "lock-btn";
      lockBtn.title = "Locked tab against accidental closure (Click to unlock)";
      lockBtn.innerHTML = typeof ICONS !== "undefined" && ICONS.lock ? ICONS.lock : "🔒";
      lockBtn.setAttribute("draggable", "false");
      lockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.gapps.toggleLockTab(tab.id);
      });
      el.appendChild(lockBtn);
    } else if (!tab.pinned) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "x";
      closeBtn.title = "Close tab (Ctrl+W)";
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

    // Middle click closes tab (if not pinned and not locked)
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1 && !tab.pinned && !tab.locked) {
        e.preventDefault();
        window.gapps.closeTab(tab.id);
      }
    });

    // Double click to rename tab
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      window.gapps.promptRenameTab(tab.id);
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

// Horizontal mouse wheel scrolling for tab strip
tabsContainer.addEventListener("wheel", (e) => {
  if (currentState && currentState.layout !== "vertical" && e.deltaY !== 0) {
    e.preventDefault();
    tabsContainer.scrollLeft += e.deltaY;
  }
}, { passive: false });

// URL bar actions
const urlCopyBtn = $("url-copy");
if (urlCopyBtn) {
  urlCopyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (currentState && currentState.active) {
      const activeTab = currentState.tabs.find((t) => t.id === currentState.active);
      if (activeTab && activeTab.url) {
        navigator.clipboard.writeText(activeTab.url).then(() => {
          urlCopyBtn.textContent = "✓";
          setTimeout(() => { urlCopyBtn.innerHTML = "&#128203;"; }, 1500);
        }).catch(() => {});
      }
    }
  });
}

// Button actions: "+" opens the New Tab Grid page!
$("new").addEventListener("click", () => window.gapps.openNewTab());
$("new").addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.gapps.showAppMenu();
});
$("reload").addEventListener("click", () => window.gapps.reloadActive());
$("home").addEventListener("click", () => window.gapps.goTabHome());
$("gear").addEventListener("click", () => window.gapps.showSettingsMenu());

const splitBtnAction = $("split-btn");
if (splitBtnAction) {
  splitBtnAction.addEventListener("click", () => {
    if (currentState && currentState.split && currentState.split.enabled) {
      window.gapps.closeSplitView();
    } else {
      window.gapps.showSplitMenu();
    }
  });
  splitBtnAction.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.gapps.showSplitMenu();
  });
}

const topToggle = $("toggle-layout-top");
if (topToggle) {
  topToggle.addEventListener("click", () => window.gapps.toggleTabLayout());
}
const stripToggle = $("toggle-layout-strip");
if (stripToggle) {
  stripToggle.addEventListener("click", () => window.gapps.toggleTabLayout());
}

// Keyboard shortcuts within tabbar
window.addEventListener("keydown", (e) => {
  if (e.altKey && e.shiftKey && (e.key === "v" || e.key === "V")) {
    e.preventDefault();
    window.gapps.toggleTabLayout();
  } else if (e.altKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    window.gapps.showSplitMenu();
  } else if (e.ctrlKey && (e.key === "t" || e.key === "T")) {
    e.preventDefault();
    window.gapps.openNewTab();
  } else if (e.ctrlKey && (e.key === "w" || e.key === "W")) {
    e.preventDefault();
    if (currentState && currentState.active) {
      const current = currentState.tabs.find((t) => t.id === currentState.active);
      if (current && !current.pinned && !current.locked) {
        window.gapps.closeTab(currentState.active);
      }
    }
  } else if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key === "Home") {
    e.preventDefault();
    window.gapps.goTabHome();
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
