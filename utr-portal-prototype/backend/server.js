const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { Pool } = require("pg");
const { google } = require("googleapis");
const { Readable } = require("stream");

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

// ---------------------------------------------------------------------
// Multer: hold the file in memory instead of writing to local disk,
// since it's going straight to Drive.
// ---------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const isVideo = file.mimetype && file.mimetype.startsWith("video/");
    const isAudio = file.mimetype && file.mimetype.startsWith("audio/");
    if (isVideo || isAudio) cb(null, true);
    else cb(new Error("Only video or audio files are allowed."));
  }
});

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

app.post("/api/upload", upload.single("video"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file was uploaded" });
  }

  const participantId = req.body.participantId || "unknown-participant";
  const category = req.body.category || req.body.promptId || "content";
  const categoryFolderName = CATEGORY_FOLDER_NAMES[category] || "Content";

  try {
    const participantFolderId = await getOrCreateFolder(DRIVE_ROOT_FOLDER_ID, participantId);
    const categoryFolderId = await getOrCreateFolder(participantFolderId, categoryFolderName);

    const finalName = datedFilename(req.file.originalname);

    const driveRes = await drive.files.create({
      requestBody: {
        name: finalName,
        parents: [categoryFolderId]
      },
      media: {
        mimeType: req.file.mimetype,
        body: Readable.from(req.file.buffer)
      },
      fields: "id, webViewLink"
    });

    console.log("File uploaded to Drive:", {
      participantId,
      category: categoryFolderName,
      driveFileId: driveRes.data.id,
      finalName
    });

    res.json({
      success: true,
      message: "File uploaded successfully",
      filename: finalName,
      originalName: req.file.originalname,
      size: req.file.size,
      driveFileId: driveRes.data.id,
      url: driveRes.data.webViewLink || null
    });
  } catch (err) {
    console.error("Drive upload failed:", err);
    res.status(500).json({ success: false, message: "Upload to Drive failed" });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ success: false, message: err.message || "Upload failed" });
});

app.listen(PORT, () => console.log(`UTR backend running on http://localhost:${PORT}`));
