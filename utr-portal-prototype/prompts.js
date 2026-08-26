// EDIT THIS FILE to change the copy shown for each upload category.
// There are exactly two categories: Content (video) and Music (audio).
// Participants can upload as many files as they like into each.
const PORTAL_CONFIG = {
  // Public backend, deployed on EasyPanel.
  apiBaseUrl: "https://undertheradarportal-utr-portalbackend.wzdj29.easypanel.host",
  maxFileSizeMB: 2000,
  categories: [
    {
      id: "content",
      title: "Content",
      accept: "video",
      description: "Upload your UGC and behind-the-scenes videos here — HeyShawty questions, arrival footage, in-between-takes moments, or anything else that shows your day.",
      instructions: [
        "MP4 or MOV format.",
        "Keep individual clips between 30 and 90 seconds where possible.",
        "Good lighting and clear sound.",
        "Upload as many clips as you like."
      ]
    },
    {
      id: "music",
      title: "Music",
      accept: "audio",
      description: "Upload the full MP3 or WAV of your entry song, plus any other music files production has requested.",
      instructions: [
        "Upload the complete track, not an excerpt.",
        "MP3 or WAV format.",
        "Make sure the file plays correctly before uploading."
      ]
    }
  ]
};
