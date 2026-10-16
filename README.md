# Gemini Nano Chat

A tiny chat page that talks to Gemini Nano, the model built into Chrome. Everything runs on your device. No API key, no server.

**Live demo:** https://semanticentity.github.io/gemini-nano-chat/

## Features

- Onboarding on load. The page checks what's missing and shows the fix: update Chrome, turn on flags, download the model, or open in its own tab. If the model is already on disk, it loads in the background so the first reply is fast.
- Markdown replies, sanitized with DOMPurify. Code blocks get a copy button.
- No images or embeds in replies, so the page never contacts outside servers on its own.
- Modes with an editable system prompt: General chat, Bias Detective, YMYL Fact Checker, E-E-A-T Audit, and Propaganda Archetypes. Add custom rules to any mode. A meter shows how much of the model's memory the prompt uses. A few locked lines always go first, so the model knows what it is and where it runs.
- E-E-A-T Audit forces JSON output with a schema, then shows it as a score table with the raw JSON below.
- Chats are saved in your browser and survive a reload. The saved chat is fed back to the model, so follow-up questions still work. Nothing is stored anywhere else.
- Multiline input: Enter sends, Shift+Enter adds a line.
- Stop button, New chat button, and a context meter.
- Light and dark mode, works at phone width.
- Falls back to plain text if the Markdown libraries can't load.

## Requirements

- Desktop Chrome 148 or later (Windows, macOS 13+, Linux, or ChromeOS on Chromebook Plus)
- About 22 GB free on the drive with your Chrome profile
- A GPU with more than 4 GB of VRAM, or 16 GB of RAM and 4+ CPU cores

The first message triggers a one-time model download. After that, it loads from disk.

## Run it locally

The page must be the top-level page. Embedded previews like CodePen block the API.

```
python3 -m http.server 8000
```

Then open http://localhost:8000/

## Troubleshooting

- **Nothing happens on Send:** check that scripts are running. Pasting HTML through DevTools "Edit as HTML" does not run `<script>` tags.
- **Model will not load:** open `chrome://on-device-internals` and check the Model Status tab.

## Docs

[The Prompt API, Chrome for Developers](https://developer.chrome.com/docs/ai/prompt-api)
