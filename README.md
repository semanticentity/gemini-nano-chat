# Gemini Nano Chat

A tiny chat page that talks to the AI model built into your browser: Gemini Nano in Chrome, or Edge's built-in model. Everything runs on your device. No API key, no server.

**Live demo:** https://semanticentity.github.io/gemini-nano-chat/

## Features

- Onboarding on load. The page checks what's missing and shows the fix: update Chrome, turn on flags, download the model, or open in its own tab. If the model is already on disk, it loads in the background so the first reply is fast.
- Markdown replies, sanitized with DOMPurify. Code blocks get a copy button.
- No images or embeds in replies, so the page never contacts outside servers on its own.
- Settings drawer:
  - Editable system prompt with a memory meter, plus saved prompts you can create, switch, and delete.
  - Reply format per prompt: Text, or JSON forced to match a schema you write.
  - Creativity (Chrome's `samplingMode`) and reply language. If Chrome refuses a setting, the page falls back and says so.
  - A few locked lines always go first, so the model knows what it is and where it runs.
- Chats are saved in your browser and survive a reload. The saved chat is fed back to the model, so follow-up questions still work. Nothing is stored anywhere else.
- Multiline input: Enter sends, Shift+Enter adds a line.
- Stop button, New chat button, and a context meter.
- Light and dark mode, works at phone width.
- Falls back to plain text if the Markdown libraries can't load.

## Browser support

The page checks for the Prompt API first, and uses it in any browser that has it. The browser only decides the wording, how the model describes itself, and which settings pages the setup cards point to.

- **Chrome 148+ on desktop:** on by default. Older Chrome gets update and flag steps.
- **Edge Canary or Dev 138+:** works after turning on the "Prompt API for on-device language model" flag. The page shows that step.
- **Other browsers and phones:** the page says what's missing and where to go instead.

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
