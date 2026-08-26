const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");
const { google } = require("googleapis");
const Busboy = require("busboy");

const app = express();
const PORT = 3001;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------
// Google Drive setup — authenticated as a real Google account via OAuth2
// (not a service account, which has no storage quota of its own).
// ---------------------------------------------------------------------
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET
);
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN
});

const drive = google.drive({ version: "v3", auth: oauth2Client });

// Cache of "parentId::folderName" -> folder ID, so we don't search/create
// the same folder repeatedly within the same process lifetime.
const folderCache = new Map();

async function getOrCreateFolder(parentId, folderName) {
  const cacheKey = `${parentId}::${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const safeName = folderName.replace(/'/g, "\\'");
  const searchRes = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive"
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    const folderId = searchRes.data.files[0].id;
    folderCache.set(cacheKey, folderId);
    return folderId;
  }

  const createRes = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id"
  });

  const folderId = createRes.data.id;
  folderCache.set(cacheKey, folderId);
  return folderId;
}

const CATEGORY_FOLDER_NAMES = {
  content: "Content",
  music: "Music"
};

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function datedFilename(originalName) {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10);            // YYYY-MM-DD
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, "-"); // HH-MM-SS
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  return `${datePart}_${timePart}_${sanitizeFilename(base)}${ext}`;
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "UTR backend is running" });
});

app.post("/api/login", async (req, res) => {
  const { participantId } = req.body;
  if (!participantId) {
    return res.status(400).json({ success: false, message: "Login ID required" });
  }
  try {
    const result = await pool.query(
      "SELECT participant_id, full_name FROM participants WHERE participant_id = $1",
      [participantId.trim().toLowerCase()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: "Login ID not recognized" });
    }
    res.json({
      success: true,
      participantId: result.rows[0].participant_id,
      participantName: result.rows[0].full_name
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------------------------------------------------------------------
// Streaming upload — the file is piped directly to Google Drive as it
// arrives from the client, instead of being fully buffered in memory
// first. This roughly halves total wait time on large files and avoids
// putting the whole file in RAM.
//
// IMPORTANT: the frontend must send the "participantId" and "category"
// fields BEFORE the "video" file field in the FormData, since we need
// to know the destination folder before the file stream starts.
// ---------------------------------------------------------------------
app.post("/api/upload", (req, res) => {
  const busboy = Busboy({
    headers: req.headers,
    limits: { fileSize: MAX_FILE_SIZE }
  });

  let participantId = "unknown-participant";
  let category = "content";
  let responded = false;
  let fileHandled = false;
  let uploadPromise = null;

  function sendOnce(status, body) {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  }

  busboy.on("field", (name, value) => {
    if (name === "participantId") participantId = value;
    if (name === "category") category = value;
    if (name === "promptId" && !category) category = value; // backward compatibility
  });

  busboy.on("file", (fieldname, fileStream, info) => {
    fileHandled = true;
    const { filename, mimeType } = info;

    const isVideo = mimeType && mimeType.startsWith("video/");
    const isAudio = mimeType && mimeType.startsWith("audio/");

    if (!isVideo && !isAudio) {
      fileStream.resume(); // drain the stream so busboy can finish
      sendOnce(400, { success: false, message: "Only video or audio files are allowed." });
      return;
    }

    let tooLarge = false;
    fileStream.on("limit", () => {
      tooLarge = true;
      fileStream.resume();
      sendOnce(400, { success: false, message: "File is larger than the 500 MB limit." });
    });

    const categoryFolderName = CATEGORY_FOLDER_NAMES[category] || "Content";
    const finalName = datedFilename(filename);

    uploadPromise = (async () => {
      if (tooLarge) return null;

      const participantFolderId = await getOrCreateFolder(DRIVE_ROOT_FOLDER_ID, participantId);
      const categoryFolderId = await getOrCreateFolder(participantFolderId, categoryFolderName);

      const driveRes = await drive.files.create({
        requestBody: {
          name: finalName,
          parents: [categoryFolderId]
        },
        media: {
          mimeType,
          body: fileStream
        },
        fields: "id, webViewLink"
      });

      return { driveRes, finalName, originalName: filename };
    })();
  });

  busboy.on("finish", async () => {
    if (!fileHandled) {
      sendOnce(400, { success: false, message: "No file was uploaded" });
      return;
    }
    if (responded) return; // already responded (e.g. bad file type / too large)

    try {
      const result = await uploadPromise;
      if (!result) return; // already handled by the "limit" branch

      console.log("File uploaded to Drive:", {
        participantId,
        category,
        driveFileId: result.driveRes.data.id,
        finalName: result.finalName
      });

      sendOnce(200, {
        success: true,
        message: "File uploaded successfully",
        filename: result.finalName,
        originalName: result.originalName,
        driveFileId: result.driveRes.data.id,
        url: result.driveRes.data.webViewLink || null
      });
    } catch (err) {
      console.error("Drive upload failed:", err);
      sendOnce(500, { success: false, message: "Upload to Drive failed" });
    }
  });

  busboy.on("error", (err) => {
    console.error("Busboy error:", err);
    sendOnce(400, { success: false, message: "Upload failed" });
  });

  req.pipe(busboy);
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ success: false, message: err.message || "Upload failed" });
});

app.listen(PORT, () => console.log(`UTR backend running on http://localhost:${PORT}`));
