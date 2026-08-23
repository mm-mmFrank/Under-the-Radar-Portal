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
  const uploaded = Array(cfg.prompts.length).fill(null);
  const API_BASE_URL = cfg.apiBaseUrl || "http://localhost:3001";

  let current = 0;

  const $ = (id) => document.getElementById(id);

  $("participantName").textContent = cfg.participantName;

  function renderChecklist() {
    const list = $("checklist");
    list.innerHTML = "";
    cfg.prompts.forEach((prompt, index) => {
      const item = document.createElement("button");
      item.className = "check-item" + (index === current ? " active" : "") + (uploaded[index] ? " complete" : "");
      item.innerHTML = `
        <span class="check-circle">${uploaded[index] ? "✓" : index + 1}</span>
        <span class="check-copy"><strong>${String(index + 1).padStart(2, "0")} · ${prompt.title}</strong><small>${uploaded[index] ? "Uploaded" : "Not uploaded"}</small></span>
      `;
      item.addEventListener("click", () => {
        // Allow going back to completed steps; future incomplete steps stay locked.
        if (index <= current || uploaded.slice(0, index).every(Boolean)) {
          current = index;
          render();
        }
      });
      list.appendChild(item);
    });
  }

  function render() {
    const prompt = cfg.prompts[current];
    $("stepNumber").textContent = String(current + 1).padStart(2, "0");
    $("promptTitle").textContent = prompt.title;
    $("promptDescription").textContent = prompt.description;
    $("promptInstructions").innerHTML = prompt.instructions.map(x => `<li>${x}</li>`).join("");

    const file = uploaded[current];
    $("nextBtn").disabled = !file;
    $("lockedNote").textContent = file ? "Ready to continue." : "Upload this video to unlock Continue.";
    $("uploadHeading").textContent = file ? "Video uploaded" : "Upload your video";
    $("uploadSubheading").textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : `MP4 or MOV · Maximum ${cfg.maxFileSizeMB} MB`;
    $("fileState").textContent = file ? "✓ Upload complete" : "";

    const count = uploaded.filter(Boolean).length;
    const pct = Math.round((count / cfg.prompts.length) * 100);
    $("progressFill").style.width = pct + "%";
    $("progressPercent").textContent = pct + "%";
    $("progressLabel").textContent = `${count} of ${cfg.prompts.length} videos uploaded`;
    $("statusText").textContent = count === cfg.prompts.length ? "Complete" : "In progress";
    renderChecklist();
  }

  $("chooseBtn").addEventListener("click", () => $("fileInput").click());

  $("fileInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const max = cfg.maxFileSizeMB * 1024 * 1024;
    if (!file.type.startsWith("video/")) {
      alert("Please choose a video file.");
      e.target.value = "";
      return;
    }
    if (file.size > max) {
      alert(`This video is larger than ${cfg.maxFileSizeMB} MB.`);
      e.target.value = "";
      return;
    }
    const prompt = cfg.prompts[current];
    const formData = new FormData();
    formData.append("video", file);
    formData.append("promptId", prompt.id);
    formData.append("participantId", cfg.participantId || "demo-participant");

    const chooseButton = $("chooseBtn");
    chooseButton.disabled = true;
    chooseButton.textContent = "Uploading…";
    $("fileState").textContent = "Uploading video…";

    try {
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: "POST",
        body: formData
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Upload failed.");
      }

      uploaded[current] = {
        name: file.name,
        size: file.size,
        filename: result.filename,
        url: result.url || null
      };
      render();
    } catch (error) {
      console.error(error);
      alert(`Upload failed: ${error.message}`);
      $("fileState").textContent = "Upload failed. Please try again.";
    } finally {
      chooseButton.disabled = false;
      chooseButton.textContent = "Choose video";
      e.target.value = "";
    }
  });

  $("nextBtn").addEventListener("click", () => {
    if (!uploaded[current]) return;
    if (current < cfg.prompts.length - 1) {
      current++;
      render();
    } else {
      $("statusText").textContent = "Complete";
      alert("All requested videos are complete in this prototype.");
    }
  });

  $("backBtn").addEventListener("click", () => {
    if (current > 0) {
      current--;
      render();
    }
  });

  $("logoutBtn").addEventListener("click", () => {
    clearSession();
    location.reload();
  });

  render();
}
