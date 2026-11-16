const $ = (id) => document.getElementById(id);

let appsList = [];

async function init() {
  try {
    appsList = await window.gapps.getApps();
    renderGrid(appsList);
  } catch (err) {
    console.error("Failed to load apps:", err);
  }

  setupSearch();
  setupKeyboard();
}

function renderGrid(apps) {
  const grid = $("apps-grid");
  grid.innerHTML = "";

  apps.forEach((app, index) => {
    const card = document.createElement("div");
    card.className = "app-card";
    card.title = `${app.title} (Press ${index < 9 ? index + 1 : "0"})`;

    const iconHtml = (typeof ICONS !== "undefined" && ICONS[app.id]) || "";

    card.innerHTML = `
      ${index < 9 ? `<span class="shortcut-badge">${index + 1}</span>` : ""}
      <div class="app-icon">${iconHtml}</div>
      <div class="app-title">${app.title}</div>
      <div class="app-desc">${app.description || ""}</div>
    `;

    card.addEventListener("click", () => {
      launchApp(app);
    });

    grid.appendChild(card);
  });
}

function launchApp(app) {
  window.gapps.navigateCurrentTab(app.url, app.id);
}

function setupSearch() {
  const input = $("search-input");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const query = input.value.trim();
      if (!query) return;

      if (query.startsWith("http://") || query.startsWith("https://")) {
        window.gapps.navigateCurrentTab(query);
      } else if (query.includes(".") && !query.includes(" ")) {
        window.gapps.navigateCurrentTab("https://" + query);
      } else {
        window.gapps.navigateCurrentTab(
          `https://www.google.com/search?q=${encodeURIComponent(query)}`
        );
      }
    }
  });
}

function setupKeyboard() {
  window.addEventListener("keydown", (e) => {
    const searchInput = $("search-input");
    if (document.activeElement === searchInput) {
      if (e.key === "Escape") {
        searchInput.value = "";
        searchInput.blur();
      }
      return;
    }

    if (e.key >= "1" && e.key <= "9") {
      const idx = parseInt(e.key, 10) - 1;
      if (appsList[idx]) {
        launchApp(appsList[idx]);
      }
    } else if (e.key === "0" && appsList[9]) {
      launchApp(appsList[9]);
    } else if (e.key === "/") {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

init();
