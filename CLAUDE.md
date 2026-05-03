# VidMark — Project notes for Claude

A Chrome extension that adds Frame.io-style timestamped video review to Google Drive. This file is for any future Claude session opening this repo so it can pick up exactly where we left off.

---

## Current state (last touched 2026-05-03)

- **Local working tree:** `/Users/markksantos/Developer/drive-frameio` (the project was moved here from `~/Desktop` mid-session)
- **Repo:** https://github.com/markksantos/VidMark — public, MIT, owner `markksantos`
- **GitHub `main` is at v1.2.0.** The full feature set is committed and pushed.
- **Chrome Web Store:** the user was filling out the v1.1.0 submission form. Privacy policy is published at `https://github.com/markksantos/VidMark/blob/main/PRIVACY.md`. Form answers (single-purpose description, storage justification, host justification) are saved verbatim near the end of the conversation that produced this file. When v1.2 ships to the store, the storage justification needs to add the `chrome.storage.local` annotation storage alongside the existing `chrome.storage.sync` settings.
- **v1.2 features ship-ready in code but not all user-tested.** User needs to reload the extension at `chrome://extensions` and refresh a Drive tab to QA: tag filter, search filter, loop between markers, drawing overlay, side-by-side compare, and the new keyboard shortcuts.

---

## What VidMark does (single sentence)

Auto-stamps `[m:ss]` into new Drive video comments using the current playback time, drops color-coded clickable markers on the timeline, lets you sort/filter/search comments, draw on paused frames, loop between two markers, compare two videos side-by-side, and export to nine formats including FCPXML (FCP / Premiere) and EDL (DaVinci Resolve / Avid). 100 % local. No server.

---

## File map (what's where)

```
manifest.json             MV3 — content_scripts on drive.google.com only,
                          storage permission, popup action, version 1.2.0
content.js                Numbered sections 1-8 inside one IIFE
  Settings + storage      chrome.storage.sync load + onChanged listener (8 toggles)
  1. Auto-stamp           insertTimestamp + live updater
  2. Timestamps           wrapAllTimestamps + clickable [m:ss] + #tag parsing
  3. Markers              timeline overlay, hueForSeconds / hueForTag
  4. Sort / Filter / Search   sort modes, tag filter, text search, 9-format export
  5. Loop between markers     set-start / set-end / 250ms re-seek interval
  6. Drawing / annotations    canvas overlay, save to chrome.storage.local
  7. Auto-reopen          mutation-based detection of new listitem after Post
  8. Hide / expand        comments-panel toggle + video-player resize
  Keyboard shortcuts      n , . / L Cmd+E Esc
  Popup messaging         VIDMARK_EXPORT, VIDMARK_SETTINGS_CHANGED handlers

styles.css                All in-page UI — markers, flash, sort layout,
                          panel, dropdown, annotation overlay
popup.html/css/js         Toolbar popup — Export / Settings / About tabs +
                          "Side-by-side compare" entry
compare.html/css/js       Side-by-side compare page (loaded via popup)
PRIVACY.md                Privacy policy — linked from Chrome Web Store form
icon-NN.png               16/32/48/128 — required Chrome icon sizes
icon-source.png           1024×1024 master
store-listing.txt         Copy-paste-ready Chrome Web Store fields
```

---

## Drive quirks — DO NOT REGRESS

These were all painfully discovered. Future Claude: don't undo any of these workarounds without checking with the user first.

- **Video player is a YouTube iframe (cross-origin).** Read playback time from Drive's own `<input aria-label="Seek slider">` in the parent frame, not from inside the iframe. The volume slider has `role="slider"` but the *seek* slider does not — match by `aria-label`.
- **Listitems are `position: absolute` with inline `top:NNNpx`.** CSS `order` does NOT work on absolutely-positioned elements. The fix is in `styles.css`: when `.gd-fio-sort-active` is on the `[role="list"]`, force `position: relative !important; top: auto !important; left: auto !important; inset: auto !important;` on `> [role="listitem"]`.
- **The list parent and its wrapper collapse to width 0** if our flex override is applied without an explicit width. We force `width: 320px !important` on `.ndfHFb-c4YZDc-qwU8Me-b0t70b-haAclf` and `.ndfHFb-c4YZDc-wvGCSb-gkA7Yd` via `:has(.gd-fio-sort-active)`.
- **NEVER add `overflow: hidden` to the comments dialog or list.** It breaks Drive's virtualization — comments appear briefly then vanish.
- **The "Post Comment" button is `<div role="button">` driven by Drive's `jsaction`.** Document-level click listeners (even capture-phase) do NOT fire on it. We detect new comments via a `MutationObserver` on the `[role="list"]` for added `[role="listitem"]` nodes.
- **The "+ Comment" toolbar button has `aria-label="Add a comment"`.** Multiple other elements in the page have visible text "Comment" (the View menu, the toolbar, etc.). Always match this button by aria-label, not text.
- **Setting `slider.value = X` doesn't trigger Drive's seek listeners.** You have to set via the native descriptor:
  ```js
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, X);
  slider.dispatchEvent(new Event('input', {bubbles: true}));
  slider.dispatchEvent(new Event('change', {bubbles: true}));
  ```
- **Inserting text into Drive's contenteditable comment box:** use `document.execCommand('insertText', ...)`. Yes it's deprecated. It's the only thing that triggers Drive's internal editor model. Fall back to a synthetic `ClipboardEvent('paste')` if execCommand returns false.
- **The video player container is `.ndfHFb-c4YZDc-aTv5jf`** with inline pixel `left/top/width/height` set by JS. To expand the player when comments are hidden, CSS `!important` on `body.gd-fio-video-expanded .ndfHFb-c4YZDc-aTv5jf` beats the inline values. After toggling, dispatch `window.dispatchEvent(new Event('resize'))` so Drive recomputes the seek bar's `--track-width`.
- **Drive folder pages also use `[role="list"]` / `[role="listitem"]`** (for the file grid). The render loop's first check is `if (!getSeekSlider()) return;` to avoid spawning our panel on folder pages.
- **Folder-view comments dialog uses different selectors.** The standalone viewer uses `.ndfHFb-c4YZDc-qwU8Me-b0t70b-haAclf`; folder-view preview uses `.a-b-Yk-hj`. The inner card chain has `Yk-*` parallels (`Yk-eKrold`, `Yk-pnL5fc-C58Yv`, etc.). Both are covered in CSS and `getCommentsDialog()`.

---

## Settings model

8 boolean toggles, all default `true` (opt-out), defined in `content.js` and exposed in the popup:

| Key | What it controls |
|-----|------------------|
| `autoStamp` | Pre-fill `[m:ss]` when a new comment opens |
| `liveUpdate` | Re-write the inserted timestamp as the user scrubs (until they type) |
| `autoReopen` | Click "+ Comment" automatically after each Post |
| `showMarkers` | Render colored circles on the seek bar |
| `clickableTimestamps` | Wrap `[m:ss]` in comment text as click-to-seek links |
| `showFloatingPanel` | Show the top-right Sort/Hide/Export panel |
| `keyboardShortcuts` | Enable n , . / L Cmd+E Esc |
| `showAnnotations` | Re-display saved drawings during playback |

- Stored via `chrome.storage.sync` (rides Chrome's existing settings sync per Google account).
- `chrome.storage.onChanged` listener live-applies changes — no reload needed when toggling in the popup.
- Annotation drawings are stored separately in `chrome.storage.local`, keyed by `vidmark:annot:${fileId}:${roundedCentiseconds}`.

---

## Conventions

- **No build step.** Vanilla JS, no npm, no bundler, no TypeScript. The extension folder *is* the deployment artifact.
- **DOM class prefix:** `gd-fio-` (legacy from initial codename "drive-frameio" — kept consistent throughout).
- **Console log tag:** `'[drive-frameio]'` (legacy too, kept for users debugging in DevTools).
- **Brand name:** VidMark (the public name, in `short_name` and on GitHub). Long manifest name: `"Video Timestamps for Google Drive — Comments & Review"`.
- **All extension code is wrapped in a single IIFE** in `content.js` to avoid global pollution.
- **Hue assignment:**
  - `hueForSeconds(sec)` — golden-ratio multiplier on seconds, deterministic.
  - `hueForTag(tag)` — FNV-1a string hash + golden ratio, deterministic.
  - When a comment has a tag, the tag's hue overrides the timestamp hue on the marker.

---

## Future features the user discussed (in their priority order)

1. **Approval workflow** — Approve / Reject / Needs-revision buttons per comment + generated approval report. *They flagged this as the single biggest monetization lever.* Not yet built.
2. **Frame-accurate timestamps** (`[01:23:45:12]`) — Drive doesn't expose framerate so it's currently impossible without cooperation from the YouTube iframe. User said skip unless we find a way.
3. **Comment templates / snippets** — saved phrases like "Color grading:" "Audio level:" Tab to cycle.
4. **Webhook / Slack / Discord integration** — explicitly deferred by user to "another time".
5. **AI summarization** — one-click action items from all open comments, using the user's own Anthropic API key.

There's also a `store-listing.txt` in the repo with copy-paste-ready Chrome Web Store form fields (name, summary, description, screenshot captions, promo tile spec).

---

## Quick refs for future-Claude

- **Reload extension to test:** `chrome://extensions` → click the reload icon on VidMark → refresh the Drive tab.
- **Bump a version:** edit `manifest.json` `"version"`, commit + push, re-zip the folder, upload to Chrome Web Store dashboard.
- **Test video URL the user has been using:** `https://drive.google.com/file/d/1h8MHrS-TljbLrtc_z5m2apx6VJ-e0eNt/view`
