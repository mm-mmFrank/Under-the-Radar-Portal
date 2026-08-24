// EDIT THIS FILE to change the participant's video/audio requests.
// The portal layout does not need to change when prompts are edited.
//
// Each prompt supports an optional "accept" field:
//   "video" -> only video files allowed for this prompt
//   "audio" -> only audio files allowed for this prompt
//   "any"   -> both video and audio allowed (default if omitted)
const PORTAL_CONFIG = {
  // Public backend, deployed on EasyPanel.
  apiBaseUrl: "https://undertheradarportal-utr-portalbackend.wzdj29.easypanel.host",
  maxFileSizeMB: 500,
  prompts: [
    {
      id: "heyshawty-questions",
      title: "UGC — HeyShawty Questions",
      description: "Record yourself answering the HeyShawty questions in your own voice and style. Keep it natural, energetic, and true to who you are.",
      accept: "video",
      instructions: [
        "Answer each question clearly, in your own words.",
        "Keep the video between 30 and 90 seconds.",
        "Film vertically unless the production team tells you otherwise.",
        "Good lighting and clear sound — no background noise or music."
      ]
    },
    {
      id: "mp3-upload",
      title: "Full Song Audio",
      description: "Upload the complete MP3 of your entry song — the original song this submission is for.",
      accept: "audio",
      instructions: [
        "Upload the full track, not an excerpt.",
        "MP3 or WAV format.",
        "Make sure the file plays correctly before uploading."
      ]
    },
    {
      id: "bts-content",
      title: "Behind The Scenes Content",
      description: "Share any behind-the-scenes moments — arriving on set, prepping, in-between takes, or anything that shows what your day looked like.",
      accept: "video",
      instructions: [
        "Capture genuine, unscripted moments.",
        "Keep individual clips between 30 and 90 seconds.",
        "Avoid filming confidential production information."
      ]
    }
  ]
};
