# VidMark — Privacy Policy

_Last updated: May 3, 2026_

VidMark ("the extension") is a Chrome extension that adds Frame.io-style timestamped comments to Google Drive videos. This page explains exactly what data the extension touches and what happens to it.

## TL;DR

**VidMark does not collect, transmit, sell, or share any user data.** It runs entirely inside your browser on `https://drive.google.com/*` pages. There is no server, no analytics, no telemetry, no account, no remote code execution.

## What the extension does access

The extension reads and modifies parts of the Google Drive page you have already opened, specifically:

- **The video player's seek slider** (a DOM `<input>` element rendered by Drive) — to read the current playback time when you start a comment, and to seek the video when you click a timeline marker.
- **Drive's comment editor** (a `contenteditable` element) — to insert the auto-stamped `[m:ss]` timestamp at the start of new comments.
- **Drive's comments list** (`[role="list"]` containing `[role="listitem"]`) — to detect existing timestamped comments, render clickable timeline markers for them, sort the list, and export the comments to a file you save locally.

All of this happens on the page you already have open in your own browser. No external server is contacted at any time.

## What the extension stores locally

- **Settings** (via `chrome.storage.sync`): six on/off toggles for the extension's features (auto-stamp, live-update, auto-reopen, markers, clickable timestamps, floating panel). These sync between your own browsers via your Google account, the same way other Chrome settings sync. We never read these values on a server we control — there is no server we control.
- **Annotations** (via `chrome.storage.local`, only if you use the drawing feature): drawings you make on top of paused video frames are saved as PNG data URIs alongside the timestamp and Drive file ID, so they re-display when you scrub back to that point in the same video on the same machine. They never leave your device.

You can clear all of this at any time by removing the extension or by visiting `chrome://settings/content` and clearing site data for the extension.

## What the extension does not do

- It does **not** collect personally identifiable information (no name, email, address, phone number, ID number).
- It does **not** collect health, financial, payment, or authentication information.
- It does **not** read or store your personal communications outside of the comment text you have already chosen to type into Drive's own comment system.
- It does **not** track your location or IP address.
- It does **not** record web history, mouse position, scroll position, or keystrokes.
- It does **not** transmit any data off your device.
- It does **not** sell, lease, or transfer any user data to third parties.
- It does **not** load or execute any remote code (no remote `<script>` tags, no remote modules, no `eval()` of fetched code).

## Permissions used

| Permission | Why VidMark needs it |
|------------|----------------------|
| Host: `https://drive.google.com/*` | The single host the extension runs on. The content script reads Drive's seek slider, comment editor, and comments list, and injects timeline markers and the floating Sort/Export panel. The extension does not run on any other site. |
| `storage` | Persisting the extension's six feature toggles (across browsers via `chrome.storage.sync`) and locally-saved drawings (via `chrome.storage.local`). All values stay inside Chrome's storage on your own device(s). |

The extension does not request `tabs`, `scripting`, `identity`, `cookies`, `webRequest`, `history`, or any other permission.

## Third-party services

VidMark does not use any third-party services — no analytics, no error reporting, no CDN, no APIs.

## Changes to this policy

If the extension ever changes what data it touches, this file will be updated and the extension version will be bumped. The full revision history is publicly visible at:

https://github.com/markksantos/VidMark/commits/main/PRIVACY.md

## Contact

Questions or concerns? Open an issue at:
https://github.com/markksantos/VidMark/issues

Or email: hello@markksantos.com
