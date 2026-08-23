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
// Google Drive setup
// GOOGLE_SERVICE_ACCOUNT_JSON must contain the full contents of the
// downloaded service account JSON key, pasted as a single-line env var.
// DRIVE_ROOT_FOLDER_ID is the folder shared with that service account.
// ---------------------------------------------------------------------
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || "1R90XPNM35sHaLLHuXtO5U5Qh6FsPXf5H";

let driveAuth;
try {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  driveAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
} catch (err) {
  console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:", err.message);
}

const drive = google.drive({ version: "v3", auth: driveAuth });

// Cache of participantId -> their Drive subfolder ID, so we don't
// search/create it on every single upload within the same process lifetime.
const folderCache = new Map();

async function getOrCreateParticipantFolder(participantId) {
  if (folderCache.has(participantId)) {
    return folderCache.get(participantId);
  }

  // Look for an existing subfolder with this name inside the root folder.
  const safeName = participantId.replace(/'/g, "\\'");
  const searchRes = await drive.files.list({
    q: `'${DRIVE_ROOT_FOLDER_ID}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive"
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    const folderId = searchRes.data.files[0].id;
    folderCache.set(participantId, folderId);
    return folderId;
  }

  // Not found — create it.
  const createRes = await drive.files.create({
    requestBody: {
      name: participantId,
      mimeType: "application/vnd.google-apps.folder",
      parents: [DRIVE_ROOT_FOLDER_ID]
    },
    fields: "id"
  });

  const folderId = createRes.data.id;
  folderCache.set(participantId, folderId);
  return folderId;
}

// ---------------------------------------------------------------------
// Multer: hold the file in memory instead of writing to local disk,
// since it's going straight to Drive.
// ---------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed."));
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
    return res.status(400).json({ success: false, message: "No video was uploaded" });
  }

  const participantId = req.body.participantId || "unknown-participant";
  const promptId = req.body.promptId || "unspecified-prompt";

  try {
    const folderId = await getOrCreateParticipantFolder(participantId);

    const uniqueName = `${promptId}-${Date.now()}${path.extname(req.file.originalname)}`;

    const driveRes = await drive.files.create({
      requestBody: {
        name: uniqueName,
        parents: [folderId]
      },
      media: {
        mimeType: req.file.mimetype,
        body: Readable.from(req.file.buffer)
      },
      fields: "id, webViewLink"
    });

    console.log("Video uploaded to Drive:", {
      participantId,
      promptId,
      driveFileId: driveRes.data.id
    });

    res.json({
      success: true,
      message: "Video uploaded successfully",
      filename: uniqueName,
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
