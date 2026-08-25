const API_BASE = PORTAL_CONFIG.apiBaseUrl;
const SESSION_KEY = "utr_session";
const SESSION_DURATION_MS = 5 * 60 * 1000; // 5 minutes

function saveSession(participantId, participantName) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    participantId,
    participantName,
    loggedInAt: Date.now()
  }));
}

function getValidSession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    const expired = Date.now() - session.loggedInAt > SESSION_DURATION_MS;
    if (expired) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function enterPortal(participantId, participantName) {
  PORTAL_CONFIG.participantName = participantName;
  PORTAL_CONFIG.participantId = participantId;
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("appShell").style.display = "";
  initPortal();
}

// On page load, restore a still-valid session instead of forcing re-login.
(function restoreSessionOnLoad() {
  const session = getValidSession();
  if (session) {
    enterPortal(session.participantId, session.participantName);
  }
})();

async function attemptLogin() {
  const input = document.getElementById("loginInput");
  const errorEl = document.getElementById("loginError");
  const participantId = input.value.trim();

  if (!participantId) {
    errorEl.textContent = "Please enter your login ID.";
    return;
  }

  try {
    const response = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId })
    });
    const result = await response.json();

    if (!result.success) {
      errorEl.textContent = result.message || "Login failed.";
      return;
    }

    saveSession(result.participantId, result.participantName);
    enterPortal(result.participantId, result.participantName);
  } catch (err) {
    console.error(err);
    errorEl.textContent = "Something went wrong. Please try again.";
  }
}

document.getElementById("loginBtn").addEventListener("click", attemptLogin);
document.getElementById("loginInput").addEventListener("keypress", (e) => {
  if (e.key === "Enter") attemptLogin();
});

function initPortal() {
  const cfg = PORTAL_CONFIG;
  const API_BASE_URL = cfg.apiBaseUrl || "http://localhost:3001";

  const $ = (id) => document.getElementById(id);

  // uploaded[categoryId] = array of { name, size, filename, url }
  const uploaded = {};
  cfg.categories.forEach(cat => { uploaded[cat.id] = []; });

  $("participantName").textContent = cfg.participantName;

  const grid = $("categoriesGrid");
  const template = $("categoryCardTemplate");
  grid.innerHTML = "";

  const cardRefs = {}; // categoryId -> { root, countEl, fileInput, chooseBtn, fileState, listEl }

  cfg.categories.forEach((category) => {
    const node = template.content.cloneNode(true);
    const root = node.querySelector(".category-card");
    root.dataset.categoryId = category.id;

    node.querySelector(".category-title").textContent = category.title;
    node.querySelector(".category-description").textContent = category.description;
    node.querySelector(".category-instructions").innerHTML =
      category.instructions.map(x => `<li>${x}</li>`).join("");

    const fileInput = node.querySelector(".category-file-input");
    fileInput.setAttribute("accept", category.accept === "audio" ? "audio/*" : "video/*");

    const hint = node.querySelector(".category-hint");
    hint.textContent = category.accept === "audio"
      ? `MP3 or WAV · Maximum ${cfg.maxFileSizeMB} MB each`
      : `MP4 or MOV · Maximum ${cfg.maxFileSizeMB} MB each`;

    grid.appendChild(node);

    cardRefs[category.id] = {
      root: grid.querySelector(`[data-category-id="${category.id}"]`),
    };
  });

  // Re-query cloned elements now that they're attached to the DOM
  cfg.categories.forEach((category) => {
    const root = cardRefs[category.id].root;
    cardRefs[category.id] = {
      root,
      countEl: root.querySelector(".category-count"),
      fileInput: root.querySelector(".category-file-input"),
      chooseBtn: root.querySelector(".category-choose-btn"),
      fileState: root.querySelector(".file-state"),
      listEl: root.querySelector(".uploaded-files-list")
    };

    cardRefs[category.id].chooseBtn.addEventListener("click", () => {
      cardRefs[category.id].fileInput.click();
    });

    cardRefs[category.id].fileInput.addEventListener("change", (e) => {
      handleFilesSelected(category, Array.from(e.target.files || []));
      e.target.value = "";
    });
  });

  function renderCategory(categoryId) {
    const files = uploaded[categoryId];
    const refs = cardRefs[categoryId];

    refs.countEl.textContent = files.length === 1 ? "1 file uploaded" : `${files.length} files uploaded`;
    refs.root.classList.toggle("has-files", files.length > 0);

    refs.listEl.innerHTML = files.map((f, i) => `
      <li class="uploaded-file-row">
        <span class="uploaded-file-name">${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" class="remove-file-btn" data-index="${i}" aria-label="Remove file">✕</button>
      </li>
    `).join("");

    refs.listEl.querySelectorAll(".remove-file-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        uploaded[categoryId].splice(idx, 1);
        renderCategory(categoryId);
        renderSummary();
      });
    });
  }

  function renderSummary() {
    const total = Object.values(uploaded).reduce((sum, list) => sum + list.length, 0);
    $("statusSummary").textContent = total === 1 ? "1 file uploaded" : `${total} files uploaded`;
  }

  async function handleFilesSelected(category, files) {
    if (files.length === 0) return;

    const max = cfg.maxFileSizeMB * 1024 * 1024;
    const refs = cardRefs[category.id];
    const wantsVideo = category.accept === "video";
    const wantsAudio = category.accept === "audio";

    refs.chooseBtn.disabled = true;
    let uploadedCount = 0;

    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");

      if (wantsVideo && !isVideo) {
        alert(`Skipped "${file.name}" — please choose a video file for ${category.title}.`);
        continue;
      }
      if (wantsAudio && !isAudio) {
        alert(`Skipped "${file.name}" — please choose an audio file (MP3 or WAV) for ${category.title}.`);
        continue;
      }
      if (file.size > max) {
        alert(`Skipped "${file.name}" — larger than ${cfg.maxFileSizeMB} MB.`);
        continue;
      }

      refs.chooseBtn.textContent = `Uploading ${uploadedCount + 1} of ${files.length}…`;
      refs.fileState.textContent = `Uploading "${file.name}"…`;

      const formData = new FormData();
      formData.append("video", file);
      formData.append("promptId", category.id);
      formData.append("category", category.id);
      formData.append("participantId", cfg.participantId || "demo-participant");

      try {
        const response = await fetch(`${API_BASE_URL}/api/upload`, {
          method: "POST",
          body: formData
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || "Upload failed.");
        }

        uploaded[category.id].push({
          name: file.name,
          size: file.size,
          filename: result.filename,
          url: result.url || null
        });
        uploadedCount++;
        renderCategory(category.id);
        renderSummary();
      } catch (error) {
        console.error(error);
        alert(`Upload failed for "${file.name}": ${error.message}`);
      }
    }

    refs.chooseBtn.disabled = false;
    refs.chooseBtn.textContent = "Add more files";
    refs.fileState.textContent = "";
  }

  $("logoutBtn").addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  cfg.categories.forEach(category => renderCategory(category.id));
  renderSummary();
}
