# Local Gemini Nano Chat

A private chat page for the AI model built into your browser: Gemini Nano in Chrome, or Edge's on-device model. It runs on your computer. No API key, no account, no server, and no cost per message.

**Try it:** https://semanticentity.github.io/gemini-nano-chat/ (desktop Chrome 148 or later)

![The chat page answering "What's 18% of 2,450?" using its calculator tool](docs/screenshot.png)

## Why on-device

Cloud AI is better at open-ended chat. This page is for the jobs where a model in your browser wins:

- **Private.** What you type stays on your computer.
- **Free.** No key and no per-message cost, however much you use it.
- **Offline.** Works without internet once the model is downloaded.
- **No backend.** It's a static page. Nothing to host or run.

## What it does

### Chat

- Markdown replies. Code blocks get a Copy button.
- Your chat is saved in this browser. After a reload, it's fed back to the model, so follow-up questions still work.
- Copy on every message, Edit on your last message, and Regenerate on the last reply. New chat has Undo.
- Starter prompts on the empty screen.

### Tools

Small models are weak at math, dates, and facts. So before each reply, a quick separate step picks a tool if one helps. The page runs tested code, then the model writes the answer using the result. A label like "Used Calculator: 0.18 * 2450 = 441" shows what ran.

- **Run locally:** calculator, date math, time until, unit converter, text stats.
- **Use the web, but ask first:** Wikipedia and weather. A box shows exactly what would be sent and where, with Allow once, Always allow, or Don't send. "Weather near me" uses your location after the browser asks.
- Each tool can be switched off in Settings. Web tools are skipped when you're offline.

### Text tools

Under pasted text and replies: **Summarize**, **Proofread**, and **Translate** (about 40 languages, with a searchable menu). They use Chrome's dedicated Summarizer, Translator, and Language Detector when available, and the chat model otherwise. Results are labeled and kept out of the chat's memory.

### Settings

- Edit the system prompt, with a meter showing how much of the model's memory it uses. Save several prompts and switch between them.
- Reply format per prompt: Text, or JSON that must match a schema you write.
- Creativity, reply language, and units (US or metric, automatic from your region).
- A few locked lines always tell the model what it is, where it runs, and the current date and time.

### Setup help

On load, the page checks what's missing and shows the fix: update Chrome, turn on a flag, download the model, or open the page in its own tab. If the model is already downloaded, it loads in the background so the first reply is fast.

## Privacy

- The AI runs on your device. This page never sends your messages to a server.
- Web tools send only what the approval box shows (like a search term, or "your location"), and only after you allow it.
- When it opens, the page loads two open source libraries, marked and DOMPurify, from jsDelivr.
- Chats and settings are stored in your browser's local storage, and nowhere else.
- Replies can't load images or embeds, so a reply can't make your browser contact other sites.

## Browser support

| Browser | Status | Needs |
|---|---|---|
| Chrome 148+ on desktop (Windows, macOS 13+, Linux, Chromebook Plus) | Works by default | 22 GB free disk space. A GPU with more than 4 GB of video memory, or 16 GB of RAM and 4 CPU cores. |
| Edge Canary or Dev 138+ (Windows 10 or 11, macOS 13.3+) | Works after turning on the "Prompt API for on-device language model" flag | 20 GB free disk space. A GPU with 5.5 GB of video memory. |
| Older Chrome, other browsers, phones | Not supported | The page says what's missing and where to go. |

The model downloads once (a few GB), then runs offline. The page checks for the AI API itself, so any browser that adds it will work.

## Results from a real run

The [tool test page](https://semanticentity.github.io/gemini-nano-chat/eval.html) asks the model 21 questions, runs the tools it picks, and checks the answers. In one run on Chrome 155 (macOS):

- Gemini Nano picked the right tool 19 of 21 times.
- On questions with a checkable answer, it got 11 of 13 right with tools, and 8 of 13 without.
- Without tools, it failed to multiply 1234 by 5678, said 45 days after November 20 is December 5 (it's January 4), and got the weekday 100 days out wrong.

Run it in your own browser and use **Copy report** to share the results.

## Run it locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000/ in Chrome. The page must be the top-level page, not inside an embedded preview like CodePen, because browsers block the AI there.

## Files

| File | What it is |
|---|---|
| `index.html` | The chat page. Markup, styles, and script in one file. |
| `tools.js` | The tools: tested code the model can call. Also used by the tool test page. |
| `eval.html` | The tool test page. Scores how well the model picks and uses tools. |
| `tests/` | Headless tests with the browser's AI faked. See [tests/README.md](tests/README.md). |

## Tests

```
cd tests
npm install
npx playwright install chromium
npm test
```

About 300 checks in under a minute. The tests fake the browser's AI, so they check the page's logic, not the model. For real model behavior, use the tool test page.

## Troubleshooting

- **The setup card asks you to turn on a flag.** Paste the address it shows into the address bar, set the flag to Enabled, then relaunch the browser.
- **The model won't load.** Open `chrome://on-device-internals` (in Edge, `edge://on-device-internals`) and check the model status.
- **"Creative" wasn't accepted.** Some Chrome versions only allow Most predictable. The page falls back and tells you.
- **Proofread says it used Gemini Nano.** Chrome's dedicated Proofreader is still in an origin trial, so the page uses the chat model instead.
- **"Weather near me" says permission was denied.** Allow location for the site in Chrome's site settings.
- **Nothing happens when you press Send.** The page's script isn't running. For example, HTML pasted through DevTools "Edit as HTML" never runs scripts.

## Docs

- [The Prompt API, Chrome for Developers](https://developer.chrome.com/docs/ai/prompt-api)
- [Built-in AI APIs, Chrome for Developers](https://developer.chrome.com/docs/ai/built-in-apis)
- [Prompt API in Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api)

## License

MIT. See [LICENSE](LICENSE).

Built by [@SemanticEntity](https://github.com/semanticentity).
