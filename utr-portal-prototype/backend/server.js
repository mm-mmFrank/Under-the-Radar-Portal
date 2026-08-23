const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const uploadDirectory = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDirectory)) fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirectory),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("video/")) cb(null, true);
    else cb(new Error("Only video files are allowed."));
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "UTR backend is running" });
});

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No video was uploaded" });
  }

  console.log("Video received:", {
    participantId: req.body.participantId,
    promptId: req.body.promptId,
    filename: req.file.filename
  });

  res.json({
    success: true,
    message: "Video uploaded successfully",
    filename: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
    url: `/uploads/${encodeURIComponent(req.file.filename)}`
  });
});

app.use("/uploads", express.static(uploadDirectory));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ success: false, message: err.message || "Upload failed" });
});

app.listen(PORT, () => console.log(`UTR backend running on http://localhost:${PORT}`));
