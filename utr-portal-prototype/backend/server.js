const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { Pool } = require("pg");
const { google } = require("googleapis");
const Busboy = require("busboy");

const app = express();
const PORT = 3001;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------
// Google Drive setup
// ---------------------------------------------------------------------
const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID;

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN
});

const drive = google.drive({
  version: "v3",
  auth: oauth2Client
});

// ---------------------------------------------------------------------
// Folder cache
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------
const CATEGORY_FOLDER_NAMES = {
  content: "Content",
  music: "Music"
};

// ---------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------
function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function datedFilename(originalName) {
  const now = new Date();

  const datePart = now.toISOString().slice(0, 10);

  const timePart = now
    .toISOString()
    .slice(11, 19)
    .replace(/:/g, "-");

  const ext = path.extname(originalName);

  const base = path.basename(originalName, ext);

  return `${datePart}_${timePart}_${sanitizeFilename(base)}${ext}`;
}

// ---------------------------------------------------------------------
// Upload limits
// ---------------------------------------------------------------------
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

// ---------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "UTR backend is running"
  });
});

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
app.post("/api/login", async (req, res) => {
  const { participantId } = req.body;

  if (!participantId) {
    return res.status(400).json({
      success: false,
      message: "Login ID required"
    });
  }

  try {
    const result = await pool.query(
      "SELECT participant_id, full_name FROM participants WHERE participant_id = $1",
      [participantId.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Login ID not recognized"
      });
    }

    res.json({
      success: true,
      participantId: result.rows[0].participant_id,
      participantName: result.rows[0].full_name
    });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});

// ---------------------------------------------------------------------
// Upload
//
// Incoming file is first written temporarily to disk.
// Once complete, it is uploaded to Google Drive using resumable upload.
//
// This avoids sending a long-running multipart stream directly from the
// participant's connection to Google Drive.
// ---------------------------------------------------------------------
app.post("/api/upload", (req, res) => {

  const busboy = Busboy({
    headers: req.headers,
    limits: {
      fileSize: MAX_FILE_SIZE
    }
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

  // ---------------------------------------------------------------
  // Form fields
  // ---------------------------------------------------------------
  busboy.on("field", (name, value) => {

    if (name === "participantId") {
      participantId = value;
    }

    if (name === "category") {
      category = value;
    }

    if (name === "promptId" && !category) {
      category = value;
    }
  });

  // ---------------------------------------------------------------
  // File
  // ---------------------------------------------------------------
  busboy.on("file", (fieldname, fileStream, info) => {

    fileHandled = true;

    const {
      filename,
      mimeType
    } = info;

    const isVideo =
      mimeType &&
      mimeType.startsWith("video/");

    const isAudio =
      mimeType &&
      mimeType.startsWith("audio/");

    if (!isVideo && !isAudio) {

      fileStream.resume();

      sendOnce(400, {
        success: false,
        message: "Only video or audio files are allowed."
      });

      return;
    }

    const categoryFolderName =
      CATEGORY_FOLDER_NAMES[category] || "Content";

    const finalName =
      datedFilename(filename);

    // Temporary file on the server.
    const tempFilename =
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(filename)}`;

    const tempPath =
      path.join(os.tmpdir(), tempFilename);

    const writeStream =
      fs.createWriteStream(tempPath);

    let tooLarge = false;

    // -------------------------------------------------------------
    // Write incoming upload to temporary disk file
    // -------------------------------------------------------------
    fileStream.pipe(writeStream);

    fileStream.on("limit", () => {

      tooLarge = true;

      fileStream.resume();

      writeStream.destroy();

      try {
        fs.unlinkSync(tempPath);
      } catch {}

      sendOnce(400, {
        success: false,
        message: "File is larger than the 2 GB limit."
      });
    });

    // -------------------------------------------------------------
    // Once the participant's upload has completely reached the
    // server, upload the finished file to Google Drive.
    // -------------------------------------------------------------
    uploadPromise = new Promise((resolve, reject) => {

      writeStream.on("finish", async () => {

        if (tooLarge) {
          resolve(null);
          return;
        }

        try {

          const participantFolderId =
            await getOrCreateFolder(
              DRIVE_ROOT_FOLDER_ID,
              participantId
            );

          const categoryFolderId =
            await getOrCreateFolder(
              participantFolderId,
              categoryFolderName
            );

          // -------------------------------------------------------
          // Google Drive RESUMABLE upload
          // -------------------------------------------------------
          const driveRes =
            await drive.files.create({

              requestBody: {
                name: finalName,
                parents: [categoryFolderId]
              },

              media: {
                mimeType,
                body: fs.createReadStream(tempPath)
              },

              fields: "id, webViewLink",

              // Important for large uploads.
              uploadType: "resumable"
            });

          // Delete temporary server file after successful upload.
          try {
            fs.unlinkSync(tempPath);
          } catch {}

          resolve({
            driveRes,
            finalName,
            originalName: filename
          });

        } catch (err) {

          console.error(
            "Drive upload failed:",
            err
          );

          // Clean up temporary file if Drive fails.
          try {
            fs.unlinkSync(tempPath);
          } catch {}

          reject(err);
        }
      });

      writeStream.on("error", (err) => {

        try {
          fs.unlinkSync(tempPath);
        } catch {}

        reject(err);
      });

      fileStream.on("error", (err) => {

        try {
          fs.unlinkSync(tempPath);
        } catch {}

        reject(err);
      });

    });
  });

  // ---------------------------------------------------------------
  // Upload complete
  // ---------------------------------------------------------------
  busboy.on("finish", async () => {

    if (!fileHandled) {

      sendOnce(400, {
        success: false,
        message: "No file was uploaded"
      });

      return;
    }

    if (responded) {
      return;
    }

    try {

      const result =
        await uploadPromise;

      if (!result) {
        return;
      }

      console.log(
        "File uploaded to Drive:",
        {
          participantId,
          category,
          driveFileId: result.driveRes.data.id,
          finalName: result.finalName
        }
      );

      sendOnce(200, {

        success: true,

        message:
          "File uploaded successfully",

        filename:
          result.finalName,

        originalName:
          result.originalName,

        driveFileId:
          result.driveRes.data.id,

        url:
          result.driveRes.data.webViewLink || null
      });

    } catch (err) {

      console.error(
        "Drive upload failed:",
        err
      );

      sendOnce(500, {
        success: false,
        message: "Upload to Drive failed"
      });
    }
  });

  // ---------------------------------------------------------------
  // Busboy errors
  // ---------------------------------------------------------------
  busboy.on("error", (err) => {

    console.error(
      "Busboy error:",
      err
    );

    sendOnce(400, {
      success: false,
      message: "Upload failed"
    });
  });

  req.pipe(busboy);
});

// ---------------------------------------------------------------------
// Generic error handler
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {

  console.error(err);

  res.status(400).json({
    success: false,
    message:
      err.message ||
      "Upload failed"
  });
});

// ---------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------
app.listen(PORT, () => {

  console.log(
    `UTR backend running on http://localhost:${PORT}`
  );

});
