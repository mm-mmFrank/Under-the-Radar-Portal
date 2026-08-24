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
  const uploaded = Array(cfg.prompts.length).fill(null).map(() => []);
  const API_BASE_URL = cfg.apiBaseUrl || "http://localhost:3001";

  let current = 0;

  const $ = (id) => document.getElementById(id);

  $("participantName").textContent = cfg.participantName;

  function renderChecklist() {
    const list = $("checklist");
    list.innerHTML = "";
    cfg.prompts.forEach((prompt, index) => {
      const done = uploaded[index].length > 0;
      const item = document.createElement("button");
      item.className = "check-item" + (index === current ? " active" : "") + (done ? " complete" : "");
      item.innerHTML = `
        <span class="check-circle">${done ? "✓" : index + 1}</span>
        <span class="check-copy"><strong>${String(index + 1).padStart(2, "0")} · ${prompt.title}</strong><small>${done ? uploaded[index].length + (uploaded[index].length === 1 ? " file uploaded" : " files uploaded") : "Not uploaded"}</small></span>
      `;
      item.addEventListener("click", () => {
        // Allow going back to completed steps; future incomplete steps stay locked.
        if (index <= current || uploaded.slice(0, index).every(list => list.length > 0)) {
          current = index;
          render();
        }
      });
      list.appendChild(item);
    });
  }

  function acceptAttrFor(prompt) {
    if (prompt.accept === "video") return "video/*";
    if (prompt.accept === "audio") return "audio/*";
    return "video/*,audio/*";
  }

  function render() {
    const prompt = cfg.prompts[current];
    $("stepNumber").textContent = String(current + 1).padStart(2, "0");
    $("promptTitle").textContent = prompt.title;
    $("promptDescription").textContent = prompt.description;
    $("promptInstructions").innerHTML = prompt.instructions.map(x => `<li>${x}</li>`).join("");
    $("fileInput").setAttribute("accept", acceptAttrFor(prompt));

    const files = uploaded[current];
    const kindLabel = prompt.accept === "audio" ? "audio" : "video";
    $("nextBtn").disabled = files.length === 0;
    $("lockedNote").textContent = files.length > 0 ? "Ready to continue." : `Upload at least one ${kindLabel} to unlock Continue.`;
    $("uploadHeading").textContent = files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"} uploaded` : `Upload your ${kindLabel}`;
    $("uploadSubheading").textContent = prompt.accept === "audio"
      ? `MP3 or WAV · Maximum ${cfg.maxFileSizeMB} MB each · Add as many as you like`
      : `MP4 or MOV · Maximum ${cfg.maxFileSizeMB} MB each · Add as many as you like`;
    $("chooseBtn").textContent = files.length > 0 ? "Add another file" : "Choose file(s)";

    const listEl = $("uploadedFilesList");
    listEl.innerHTML = files.map((f, i) => `
      <li class="uploaded-file-row">
        <span class="uploaded-file-name">${f.name} · ${(f.size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" class="remove-file-btn" data-index="${i}" aria-label="Remove file">✕</button>
      </li>
    `).join("");
    listEl.querySelectorAll(".remove-file-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.getAttribute("data-index"), 10);
        uploaded[current].splice(idx, 1);
        render();
      });
    });

    $("fileState").textContent = "";

    const completedSteps = uploaded.filter(list => list.length > 0).length;
    const pct = Math.round((completedSteps / cfg.prompts.length) * 100);
    $("progressFill").style.width = pct + "%";
    $("progressPercent").textContent = pct + "%";
    $("progressLabel").textContent = `${completedSteps} of ${cfg.prompts.length} steps completed`;
    $("statusText").textContent = completedSteps === cfg.prompts.length ? "Complete" : "In progress";
    renderChecklist();
  }

  $("chooseBtn").addEventListener("click", () => $("fileInput").click());

  $("fileInput").addEventListener("change", async (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    const max = cfg.maxFileSizeMB * 1024 * 1024;
    const prompt = cfg.prompts[current];
    const wantsVideo = prompt.accept === "video";
    const wantsAudio = prompt.accept === "audio";

    const chooseButton = $("chooseBtn");
    chooseButton.disabled = true;

    let uploadedCount = 0;
    for (const file of selectedFiles) {
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");

      if (wantsVideo && !isVideo) {
        alert(`Skipped "${file.name}" — please choose a video file for this step.`);
        continue;
      }
      if (wantsAudio && !isAudio) {
        alert(`Skipped "${file.name}" — please choose an audio file (MP3 or WAV) for this step.`);
        continue;
      }
      if (!wantsVideo && !wantsAudio && !isVideo && !isAudio) {
        alert(`Skipped "${file.name}" — please choose a video or audio file.`);
        continue;
      }
      if (file.size > max) {
        alert(`Skipped "${file.name}" — larger than ${cfg.maxFileSizeMB} MB.`);
        continue;
      }

      chooseButton.textContent = `Uploading ${uploadedCount + 1} of ${selectedFiles.length}…`;
      $("fileState").textContent = `Uploading "${file.name}"…`;

      const formData = new FormData();
      formData.append("video", file);
      formData.append("promptId", prompt.id);
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

        uploaded[current].push({
          name: file.name,
          size: file.size,
          filename: result.filename,
          url: result.url || null
        });
        uploadedCount++;
        render();
      } catch (error) {
        console.error(error);
        alert(`Upload failed for "${file.name}": ${error.message}`);
      }
    }

    chooseButton.disabled = false;
    $("fileState").textContent = "";
    e.target.value = "";
    render();
  });

  $("nextBtn").addEventListener("click", () => {
    if (uploaded[current].length === 0) return;
    if (current < cfg.prompts.length - 1) {
      current++;
      render();
    } else {
      $("statusText").textContent = "Complete";
      alert("All requested uploads are complete in this prototype.");
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
