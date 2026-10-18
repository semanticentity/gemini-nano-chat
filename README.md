# Local Gemini Nano Chat

A private chat page for the AI model built into your browser: Gemini Nano in Chrome, or Edge's on-device model. It runs on your computer. No API key, no account, no server, and no cost per message.

**Try it:** https://semanticentity.github.io/gemini-nano-chat/ (desktop Chrome 148 or later. Phones are not supported, see [Phones](#phones).)

![The chat page answering "What's 18% of 2,450?" using its calculator tool](docs/screenshot.png)

## Why on-device

Cloud AI is better at open-ended chat. This page is for the jobs where a model in your browser wins:

- **Private.** What you type stays on your computer.
- **Free.** No key and no per-message cost, however much you use it.
- **Offline.** Works without internet once the model is downloaded.
- **No backend.** It's a static page. Nothing to host or run.

The catch: Gemini Nano is small. It has a 9,216 token context window (on the Chrome this was built against) and is weak at math, dates, and facts. Most of the design below works around that.

## How it works

Everything is plain JavaScript in `index.html` and `tools.js`. No build step, no framework.

### A message, start to finish

1. **Send.** `handleSend()` calls `getSession()` right away, while the click still counts as a user gesture. Chrome requires one to start a model download.
2. **Pick a tool.** A second, separate model session (the "router") gets the message. Its system prompt is a short tool catalog from `catalogPrompt()`, about 380 tokens. The router is created once and `clone()`d for each message, then destroyed, so routing never fills up the chat's memory. It replies in JSON mode: `prompt()` with a `responseConstraint` schema from `routeSchema()`, where `tool` is an enum of the enabled tool names plus `"none"`. If the browser rejects the schema, it asks for plain JSON and parses that instead. Any failure means "no tool".
3. **Follow-ups.** The router also sees your previous message, labeled "for context only", so "and in Celsius?" can fill in the missing place.
4. **Validate and run.** `runTool()` checks the arguments with the tool's `validate()`, then runs it. It never throws. Errors come back as data.
5. **Ask before the network.** Tools with a `network` host (Wikipedia, weather) stop and show an inline box with the exact text and host. Nothing is fetched until you pick Allow once or Always allow. "Always" saves the host to settings. Stop or Don't send cancels with no request made.
6. **Answer.** The tool result is appended to your message as `[Result from the Calculator tool: {...}] Use this result in your answer. Trust it over your own guess.` The chat session then writes the reply. If the tool failed or you declined, the model is told that instead, and asked to say so.
7. **Show what ran.** A collapsible line like "Used Calculator: 0.18 * 2450 = 441" goes above the reply. Click it to see the raw call and result.
8. **Render.** Markdown is parsed with marked, then cleaned with DOMPurify. Images, iframes, forms, and inline styles are stripped, so a reply can't load anything from another site. Code blocks get a Copy button.
9. **Save.** The exchange goes into local storage, including the tool call, so the label comes back after a reload.

### The model session

- **System prompt.** Two parts. A locked part from `identityText()` says what the model is, that it runs locally with no internet, which units to use, and that each message ends with a time note. Then your editable prompt. The locked part exists because Nano otherwise claimed to be Gemma running on Google's servers.
- **Current time.** Every message gets `(Background note, do not repeat: it is now Sat, Oct 17, 2026, 10:21 AM CDT (America/Chicago).)` appended at the end. It goes at the end because small models echo whatever comes first. `stripEcho()` removes it if the model repeats it anyway, before display, before saving, and before replaying old replies.
- **Creativity fallbacks.** `LanguageModel.create()` is tried with your chosen `samplingMode` and language hints, then with `most-predictable`, then without language hints, then with nothing. Chrome builds with speculative decoding (MTP) only accept `most-predictable`. If the browser didn't accept your choice, a toast says what it's using instead.
- **Memory after reload.** On load, the last 20 saved messages are passed back as `initialPrompts`. If that's too long (`QuotaExceededError`), it tries 4, then 0. When the chat overflows the window, Chrome drops the oldest turns and the page says so.
- **Memory meter.** The status bar shows `contextUsage` of `contextWindow` after each reply. Settings shows how many tokens your system prompt costs, using `measureContextUsage()`.

### Tools

| Tool | What runs | Network |
|---|---|---|
| Calculator | A small expression parser written for this. No `eval`. Handles `% ^ sqrt round` and `2,450` style numbers. | None |
| Days between, Add days | Calendar math in UTC, so daylight saving can't shift a day. | None |
| Time until | Parses "5pm", "17:00", "midnight", or "2026-12-31T23:59". Uses your time zone. | None |
| Unit converter | Lookup tables for length, weight, volume, speed, area, and temperature. | None |
| Text stats | Counts words, sentences, and characters. | None |
| Wikipedia | MediaWiki API, one request: search plus the intro of the top match. | en.wikipedia.org |
| Weather | Open-Meteo geocoding, then a 3 day forecast. "Near me" uses `navigator.geolocation`, which the browser asks about. | open-meteo.com |

Both web APIs are free, need no key, and allow requests from web pages. Web tools are left out of the catalog when `navigator.onLine` is false. Each tool can be switched off in Settings, which removes it from the router's catalog and schema.

### Text tools

Summarize, Proofread, and Translate appear under long pasted messages and replies. Each one uses the browser's dedicated API when `availability()` says it can run, and falls back to a one-off Nano session otherwise:

- **Summarize:** Chrome's Summarizer (`key-points`, markdown).
- **Proofread:** Chrome's Proofreader. It's still in an origin trial, so in practice this uses Nano.
- **Translate:** LanguageDetector finds the source language, then Translator does the work. About 40 target languages. If no Translator is available, Nano handles the languages it supports.

Results are labeled with what produced them, like "Summary (Chrome Summarizer)". They're saved with a `noContext` flag, so they're never fed back into the chat model.

### Setup checks

On load, the page decides which card to show:

1. Inside an iframe? Browsers block the API there, so it offers to open a new tab.
2. No `LanguageModel` global? It reads the browser and version from `navigator.userAgentData` (or the user agent string) and shows the fix: update Chrome, turn on the two flags, use Edge Canary with its flag, or use a computer.
3. `availability()` is called twice, with and without `samplingMode`, with an 8 second timeout. The best answer wins.
4. `available` loads the model in the background. `downloadable` shows a Download button with the disk space needed. `downloading` shows progress. `unavailable` shows the hardware requirements and a link to the browser's internals page.

### Storage

All in `localStorage`, namespaced because every github.io page shares one origin:

- `gemini-nano-chat:history:v1`: the last 100 messages.
- `gemini-nano-chat:settings:v2`: saved prompts, reply format and JSON schema, creativity, language, units, and tool settings.

## Privacy

- The AI runs on your device. This page never sends your messages to a server.
- Web tools send only what the approval box shows (like a search term, or "your location"), and only after you allow it.
- When it opens, the page loads two open source libraries, marked and DOMPurify, from jsDelivr, pinned with integrity hashes.
- Chats and settings are stored in your browser's local storage, and nowhere else.

## Browser support

| Browser | Status | Needs |
|---|---|---|
| Chrome 148+ on desktop (Windows 10 or 11, macOS 13+, Linux, Chromebook Plus) | Works by default | 22 GB free disk space. A GPU with more than 4 GB of video memory, or 16 GB of RAM and 4 CPU cores. |
| Edge Canary or Dev 138+ (Windows 10 or 11, macOS 13.3+) | Works after turning on the "Prompt API for on-device language model" flag | 20 GB free disk space. A GPU with 5.5 GB of video memory. |
| Older Chrome, Firefox, Safari | Not supported | The page says what's missing and where to go. |
| Phones and tablets | Not supported | See below. |

The model downloads once (a few GB), then runs offline. The page checks for the `LanguageModel` API itself, not the browser name, so any browser that adds it will work.

### Phones

This doesn't work on phones, and the page can't fix that. Chrome's docs say the built-in AI APIs aren't supported yet in Chrome for Android, on iOS, or on Chromebooks that aren't Chromebook Plus. Android phones do run Gemini Nano, but only for apps through Android's AICore. Chrome doesn't expose it to web pages. On a phone, the page shows a "Phones are not supported yet" card.

Two ways it could work later:

- **Chrome adds the API on Android.** Nothing here would need to change, since the page checks for the API.
- **Ship a model with the page.** Libraries like WebLLM or Transformers.js run small models in the browser over WebGPU. That means a large download per device and slower replies, and it's no longer "the AI built into your browser." It would be a different project.

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

Then open http://localhost:8000/ in Chrome. It must be the top-level page, not inside an embedded preview like CodePen, because browsers block the AI in iframes. Opening `index.html` as a file won't work either, because `tools.js` is an ES module.

## Files

| File | What it is |
|---|---|
| `index.html` | The chat page. Markup, styles, and script in one file. |
| `tools.js` | The tools, the router catalog, and its JSON schema. Also used by the tool test page. |
| `eval.html` | The tool test page. Scores how well the model picks and uses tools. |
| `tests/` | Headless tests with the browser's AI faked. See [tests/README.md](tests/README.md). |

## Tests

```
cd tests
npm install
npx playwright install chromium
npm test
```

About 300 checks in under a minute. The tests fake `LanguageModel`, the other AI APIs, and every network call, so they check the page's logic, not the model. For real model behavior, use the tool test page.

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
