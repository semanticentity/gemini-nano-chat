# Tests

Headless tests for the chat page (`index.html`), the tool test page (`eval.html`), and `tools.js`.

The pages are loaded into real Chromium with Playwright, but the browser's built-in AI is faked: `LanguageModel`, `Summarizer`, `Translator`, `LanguageDetector`, and every network call (Wikipedia, Open-Meteo, jsDelivr). So the tests run anywhere, offline, with no model downloaded. They check the page's logic, not the model's answers. For real model behavior, open `eval.html` in Chrome.

## Run

```
cd tests
npm install
npx playwright install chromium
npm test
```

About 300 checks across 9 files, in under a minute. Each file prints `PASS` or `FAIL` lines. `npm test` exits non-zero if anything fails.

Run one file with `node settings.test.js`. Screenshots go to `tests/output/`, which is gitignored. Look at them after UI changes.

## Files

| File | Covers |
|---|---|
| `tools.test.mjs` | Calculator parser, dates, units, text stats, `runTool` error handling |
| `tools-time-weather.test.mjs` | "Time until" parsing and daylight saving, weather "here" with location |
| `onboard.test.js` | Setup cards for each browser and model state: Chrome, Edge, other browsers, phones, user agent fallback |
| `persist.test.js` | Saved chat: reload, model memory replay, too-long fallback, corrupt storage |
| `undo.test.js` | New chat and the Undo toast |
| `settings.test.js` | Settings drawer: prompts, saved prompts, JSON format, creativity and language fallbacks |
| `chattools.test.js` | Tools in the chat: routing, approval (allow, always, deny, stop), errors, saved labels |
| `features.test.js` | Starters, Copy/Edit/Regenerate, Summarize/Proofread/Translate, language menu, units, near me, offline, timestamp echo |
| `evaltest.test.js` | Eval page scoring, with a fake model that makes 5 deliberate mistakes |

`lib.js` has the shared helpers. `check(name, results, { allowFalse, equals })` fails on any `false` value (unless listed in `allowFalse`), on any non-empty `errors` array, and on any `equals` mismatch.

## Writing a test

Copy the closest existing file. The pattern:

1. Fake the AI with `page.addInitScript(...)` before `page.goto`. Each fake `LanguageModel.create()` returns a session whose `prompt()` answers based on the system prompt: the tool router's starts with `You route`, the chat's starts with `Facts about you`.
2. Route the page files, jsDelivr (`cdnPath()`), and any web APIs with `page.route`.
3. Click and type like a person, collect results into an object, then call `check()`.

## Gotchas

- **Secure origin.** Location and the clipboard only work on secure origins. Serve from `http://localhost:8123/` (as `features.test.js` does), not a made-up host.
- **Don't wait on things that may not exist.** `locator.textContent()` waits 30 seconds for a missing element. Check `count()` first.
- **The router sees the previous message.** Messages to the tool router look like `Earlier message, for context only: "..."` then `New message: ...`. Fake routers should match on the new message only.
- **Avoid date-dependent fakes.** A fake answer that's right on some days and wrong on others makes a flaky test.
- **Escaping inside fakes.** Fakes are JavaScript inside a template string. A newline inside a quoted string needs `\\n` in the test file.
