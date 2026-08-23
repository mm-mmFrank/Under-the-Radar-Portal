# Under The Radar Participant Portal — Front-End Prototype

This is a front-end-only prototype for the participant video submission portal.

## Edit the requested videos
Open `prompts.js`. Change `PORTAL_CONFIG.prompts` to add/remove/edit video requests. The layout does not need to change.

Each prompt supports:
- `id`
- `title`
- `description`
- `instructions` (an array of checklist/instruction lines)

## What this prototype demonstrates
- Mobile-first participant UI
- Under The Radar red/black visual direction
- Top progress bar
- Prompt-by-prompt checklist
- Video file selection
- File type and size validation
- Continue button locked until a video is selected
- Participants can revisit completed prompts

## Important
The selected videos are NOT uploaded to a server yet. This prototype only records the selected files in the browser session. In the backend phase we will connect the upload button to persistent storage and n8n.
