const API_BASE =
  PORTAL_CONFIG.apiBaseUrl;

const SESSION_KEY =
  "utr_session";

const SESSION_DURATION_MS =
  5 * 60 * 1000;


/* =========================================================
   SESSION
   ========================================================= */

function saveSession(
  participantId,
  participantName
) {

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({

      participantId,

      participantName,

      loggedInAt:
        Date.now()

    })
  );

}


function getValidSession() {

  const raw =
    localStorage.getItem(
      SESSION_KEY
    );

  if (!raw) return null;

  try {

    const session =
      JSON.parse(raw);

    const expired =
      Date.now() -
      session.loggedInAt >
      SESSION_DURATION_MS;

    if (expired) {

      localStorage.removeItem(
        SESSION_KEY
      );

      return null;

    }

    return session;

  } catch {

    localStorage.removeItem(
      SESSION_KEY
    );

    return null;

  }

}


function clearSession() {

  localStorage.removeItem(
    SESSION_KEY
  );

}


/* =========================================================
   ENTER PORTAL
   ========================================================= */

function enterPortal(
  participantId,
  participantName
) {

  PORTAL_CONFIG.participantId =
    participantId;

  PORTAL_CONFIG.participantName =
    participantName;

  document.getElementById(
    "loginScreen"
  ).style.display = "none";

  document.getElementById(
    "appShell"
  ).style.display = "";

  document.getElementById(
    "participantName"
  ).textContent =
    participantName;

}


/* =========================================================
   RESTORE SESSION
   ========================================================= */

(function restoreSession() {

  const session =
    getValidSession();

  if (session) {

    enterPortal(
      session.participantId,
      session.participantName
    );

  }

})();


/* =========================================================
   LOGIN
   ========================================================= */

async function attemptLogin() {

  const input =
    document.getElementById(
      "loginInput"
    );

  const errorEl =
    document.getElementById(
      "loginError"
    );

  const participantId =
    input.value.trim();

  if (!participantId) {

    errorEl.textContent =
      "Please enter your login ID.";

    return;

  }

  try {

    const response =
      await fetch(
        `${API_BASE}/api/login`,
        {

          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            participantId
          })

        }
      );

    const result =
      await response.json();

    if (!result.success) {

      errorEl.textContent =
        result.message ||
        "Login failed.";

      return;

    }

    saveSession(
      result.participantId,
      result.participantName
    );

    enterPortal(
      result.participantId,
      result.participantName
    );

  } catch (error) {

    console.error(error);

    errorEl.textContent =
      "Unable to connect to the portal.";

  }

}


document
  .getElementById("loginBtn")
  .addEventListener(
    "click",
    attemptLogin
  );


document
  .getElementById("loginInput")
  .addEventListener(
    "keypress",
    (event) => {

      if (
        event.key === "Enter"
      ) {

        attemptLogin();

      }

    }
  );


/* =========================================================
   UPLOAD FUNCTION
   ========================================================= */

async function uploadFiles(
  files,
  category,
  statusElement,
  listElement,
  buttonElement
) {

  if (!files.length) return;


  const maxSize =
    PORTAL_CONFIG.maxFileSizeMB *
    1024 *
    1024;


  buttonElement.disabled =
    true;


  for (
    let i = 0;
    i < files.length;
    i++
  ) {

    const file =
      files[i];


    /* -----------------------------------------------------
       VALIDATION
       ----------------------------------------------------- */

    if (
      category === "Content" &&
      !file.type.startsWith(
        "video/"
      )
    ) {

      alert(
        `${file.name} is not a video file.`
      );

      continue;

    }


    if (
      category === "Music" &&
      !file.type.startsWith(
        "audio/"
      )
    ) {

      alert(
        `${file.name} is not an audio file.`
      );

      continue;

    }


    if (
      file.size > maxSize
    ) {

      alert(
        `${file.name} is larger than ${PORTAL_CONFIG.maxFileSizeMB} MB.`
      );

      continue;

    }


    /* -----------------------------------------------------
       STATUS
       ----------------------------------------------------- */

    statusElement.textContent =
      `Uploading ${i + 1} of ${files.length}: ${file.name}`;


    /* -----------------------------------------------------
       FORM DATA
       ----------------------------------------------------- */

    const formData =
      new FormData();

    formData.append(
      "file",
      file
    );

    formData.append(
      "category",
      category
    );

    formData.append(
      "participantId",
      PORTAL_CONFIG.participantId
    );


    try {

      const response =
        await fetch(
          `${API_BASE}/api/upload`,
          {

            method: "POST",

            body: formData

          }
        );


      const result =
        await response.json();


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          "Upload failed."
        );

      }


      /* ---------------------------------------------------
         ADD FILE TO UI
         --------------------------------------------------- */

      const item =
        document.createElement(
          "li"
        );

      item.className =
        "file-item";

      item.innerHTML = `

        <span class="file-check">
          ✓
        </span>

        <span class="file-name">
          ${file.name}
        </span>

        <span class="file-date">
          ${result.date}
        </span>

      `;

      listElement.prepend(
        item
      );


    } catch (error) {

      console.error(error);

      alert(
        `Upload failed for ${file.name}: ${error.message}`
      );

    }

  }


  buttonElement.disabled =
    false;

  statusElement.textContent =
    "All selected files uploaded successfully.";

}


/* =========================================================
   CONTENT UPLOAD
   ========================================================= */

const contentInput =
  document.getElementById(
    "contentInput"
  );

const contentButton =
  document.getElementById(
    "contentButton"
  );

const contentStatus =
  document.getElementById(
    "contentStatus"
  );

const contentFiles =
  document.getElementById(
    "contentFiles"
  );


contentButton.addEventListener(
  "click",
  () => {

    contentInput.click();

  }
);


contentInput.addEventListener(
  "change",
  async (event) => {

    const files =
      Array.from(
        event.target.files || []
      );

    await uploadFiles(
      files,
      "Content",
      contentStatus,
      contentFiles,
      contentButton
    );

    event.target.value =
      "";

  }
);


/* =========================================================
   MUSIC UPLOAD
   ========================================================= */

const musicInput =
  document.getElementById(
    "musicInput"
  );

const musicButton =
  document.getElementById(
    "musicButton"
  );

const musicStatus =
  document.getElementById(
    "musicStatus"
  );

const musicFiles =
  document.getElementById(
    "musicFiles"
  );


musicButton.addEventListener(
  "click",
  () => {

    musicInput.click();

  }
);


musicInput.addEventListener(
  "change",
  async (event) => {

    const files =
      Array.from(
        event.target.files || []
      );

    await uploadFiles(
      files,
      "Music",
      musicStatus,
      musicFiles,
      musicButton
    );

    event.target.value =
      "";

  }
);


/* =========================================================
   LOGOUT
   ========================================================= */

document
  .getElementById("logoutBtn")
  .addEventListener(
    "click",
    () => {

      clearSession();

      location.reload();

    }
  );
