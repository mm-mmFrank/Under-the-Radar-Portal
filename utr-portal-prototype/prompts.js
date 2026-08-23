// EDIT THIS FILE to change the participant's video requests.
// The portal layout does not need to change when prompts are edited.
const PORTAL_CONFIG = {
  // Public backend, deployed on EasyPanel.
  apiBaseUrl: "https://undertheradarportal-utr-portalbackend.wzdj29.easypanel.host",
  maxFileSizeMB: 500,
  prompts: [
    {
      id: "bts-arrival",
      title: "Arrival & First Impressions",
      description: "Capture a short behind-the-scenes video when you arrive on set. Show us the atmosphere, your first reaction and what is happening around you.",
      instructions: [
        "Keep the video between 30 and 90 seconds.",
        "Film vertically unless the production team tells you otherwise.",
        "Make sure the location and people around you are visible where appropriate."
      ]
    },
    {
      id: "bts-process",
      title: "Behind The Process",
      description: "Show us something interesting happening behind the scenes while your production is underway.",
      instructions: [
        "Capture a genuine moment rather than a scripted introduction.",
        "Keep the video between 30 and 90 seconds.",
        "Avoid filming confidential production information."
      ]
    },
    {
      id: "bts-reaction",
      title: "Your Reaction",
      description: "Record your reaction after completing the day's activity. Tell us what stood out to you and how the experience felt.",
      instructions: [
        "Speak clearly and keep the camera steady.",
        "Keep the video between 30 and 90 seconds.",
        "Be yourself — this should feel natural and personal."
      ]
    }
  ]
};
