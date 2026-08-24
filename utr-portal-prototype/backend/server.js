const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { Pool } = require("pg");
const { google } = require("googleapis");
const { Readable } = require("stream");

const app = express();
const PORT = 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

app.use(cors());
app.use(express.json());

/* =========================================================
   GOOGLE DRIVE
   ========================================================= */

const DRIVE_ROOT_FOLDER_ID =
  process.env.DRIVE_ROOT_FOLDER_ID ||
  "1R90XPNM35sHaLLHuXtO5U5Qh6FsPXf5H";

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

/* =========================================================
   DRIVE FOLDER CACHE
   ========================================================= */

const folderCache = new Map();

async function findOrCreateFolder(name, parentId) {

  const cacheKey = `${parentId}:${name}`;

  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }

  const safeName = name.replace(/'/g, "\\'");

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
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id"
  });

  const folderId = createRes.data.id;

  folderCache.set(cacheKey, folderId);

  return folderId;
}


/* =========================================================
   PARTICIPANT → DATE → CATEGORY
   ========================================================= */

async function getUploadFolder(participantId, category) {

  const participantFolder = await findOrCreateFolder(
    participantId,
    DRIVE_ROOT_FOLDER_ID
  );

  // South African/local server date
  const date = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Johannesburg"
  });

  const dateFolder = await findOrCreateFolder(
    date,
    participantFolder
  );

  const categoryFolder = await findOrCreateFolder(
    category,
    dateFolder
  );

  return {
    folderId: categoryFolder,
    date
  };
}


/* =========================================================
   MULTER
   ========================================================= */

const upload = multer({

  storage: multer.memoryStorage(),

  limits: {
    fileSize: 500 * 1024 * 1024
  },

  fileFilter: (req, file, cb) => {

    const isVideo =
      file.mimetype &&
      file.mimetype.startsWith("video/");

    const isAudio =
      file.mimetype &&
      file.mimetype.startsWith("audio/");

    if (isVideo || isAudio) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only video or audio files are allowed."
        )
      );
    }
  }

});


/* =========================================================
   HEALTH CHECK
   ========================================================= */

app.get("/api/health", (req, res) => {

  res.json({
    status: "OK",
    message: "UTR backend is running"
  });

});


/* =========================================================
   LOGIN
   ========================================================= */

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
      `
      SELECT participant_id, full_name
      FROM participants
      WHERE participant_id = $1
      `,
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

      participantId:
        result.rows[0].participant_id,

      participantName:
        result.rows[0].full_name

    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      success: false,
      message: "Server error"
    });

  }

});


/* =========================================================
   UPLOAD
   ========================================================= */

app.post(
  "/api/upload",
  upload.single("file"),
  async (req, res) => {

    if (!req.file) {

      return res.status(400).json({
        success: false,
        message: "No file was uploaded"
      });

    }

    const participantId =
      req.body.participantId ||
      "unknown-participant";

    const category =
      req.body.category;

    if (!["Content", "Music"].includes(category)) {

      return res.status(400).json({
        success: false,
        message: "Invalid upload category"
      });

    }

    try {

      const {
        folderId,
        date
      } = await getUploadFolder(
        participantId,
        category
      );


      /* -----------------------------------------------------
         CREATE CLEAN FILE NAME
         ----------------------------------------------------- */

      const originalExtension =
        path.extname(req.file.originalname);

      const originalBase =
        path.basename(
          req.file.originalname,
          originalExtension
        )
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .substring(0, 80);

      const uniqueName =
        `${date}_${category}_${originalBase}_${Date.now()}${originalExtension}`;


      /* -----------------------------------------------------
         UPLOAD TO GOOGLE DRIVE
         ----------------------------------------------------- */

      const driveRes =
        await drive.files.create({

          requestBody: {

            name: uniqueName,

            parents: [folderId]

          },

          media: {

            mimeType:
              req.file.mimetype,

            body:
              Readable.from(req.file.buffer)

          },

          fields:
            "id,name,webViewLink"

        });


      console.log(
        "File uploaded to Drive:",
        {
          participantId,
          category,
          date,
          driveFileId:
            driveRes.data.id,
          filename:
            uniqueName
        }
      );


      res.json({

        success: true,

        message:
          "File uploaded successfully",

        filename:
          uniqueName,

        originalName:
          req.file.originalname,

        category,

        date,

        size:
          req.file.size,

        driveFileId:
          driveRes.data.id,

        url:
          driveRes.data.webViewLink || null

      });

    } catch (err) {

      console.error(
        "Drive upload failed:",
        err
      );

      res.status(500).json({

        success: false,

        message:
          "Upload to Google Drive failed"

      });

    }

  }
);


/* =========================================================
   ERROR HANDLER
   ========================================================= */

app.use((err, req, res, next) => {

  console.error(err);

  res.status(400).json({

    success: false,

    message:
      err.message ||
      "Upload failed"

  });

});


/* =========================================================
   START SERVER
   ========================================================= */

app.listen(PORT, () => {

  console.log(
    `UTR backend running on http://localhost:${PORT}`
  );

});
