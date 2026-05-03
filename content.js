// Drive Frame.io — auto-stamp comments + timeline markers for Google Drive video review.
// Drive's player is a YouTube iframe; the seek slider lives in the Drive frame as
// <input aria-label="Seek slider" min="0" max="<duration_ms>" value="<current_ms>">.
(() => {
  const TAG = '[drive-frameio]';
  const TS_REGEX = /\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/g;
  const MARKER_CLASS = 'gd-fio-marker';
  const MARKER_LAYER_CLASS = 'gd-fio-marker-layer';

  console.log(`${TAG} content script loaded on`, location.href);

  // ---------- Settings (synced via chrome.storage.sync, defaults all true) ----------

  const settings = {
    autoStamp: true,
    liveUpdate: true,
    autoReopen: true,
    showMarkers: true,
    clickableTimestamps: true,
    showFloatingPanel: true,
    keyboardShortcuts: true,
    showAnnotations: true,
  };

  function loadSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
    try {
      chrome.storage.sync.get(Object.keys(settings), (stored) => {
        for (const key of Object.keys(settings)) {
          if (stored && stored[key] !== undefined) settings[key] = !!stored[key];
        }
      });
    } catch (_) {}
  }
  loadSettings();

  // ---------- Time helpers ----------

  function fmt(seconds) {
    const t = Math.max(0, Math.floor(seconds));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  // Stable pastel hue per timestamp. Golden-ratio multiplier keeps adjacent
  // timestamps visually distinct around the color wheel.
  function hueForSeconds(sec) {
    const phi = 0.6180339887498949;
    return Math.floor(((sec * phi) % 1 + 1) % 1 * 360);
  }

  // Stable hue per #tag string. Uses a tiny string hash + golden ratio so
  // similar tag names land on visibly different colors.
  function hueForTag(tag) {
    let h = 2166136261;
    const s = String(tag).toLowerCase();
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const phi = 0.6180339887498949;
    return Math.floor((((h >>> 0) / 4294967295) * phi % 1) * 360);
  }

  // Hashtags inside comment bodies. Matches things like #fix, #color-grade,
  // #audio_2 — letters/digits/underscore/hyphen, must start with a letter.
  const TAG_REGEX = /(^|\s)#([a-zA-Z][\w-]{0,31})\b/g;
  function parseTags(text) {
    if (!text) return [];
    const found = new Set();
    let m;
    TAG_REGEX.lastIndex = 0;
    while ((m = TAG_REGEX.exec(text)) !== null) {
      found.add(m[2].toLowerCase());
    }
    return Array.from(found);
  }

  function parseAriaDuration(str) {
    if (!str) return NaN;
    let total = 0;
    const h = /(\d+)\s*hours?/.exec(str);
    const m = /(\d+)\s*minutes?/.exec(str);
    const s = /(\d+)\s*seconds?/.exec(str);
    if (h) total += parseInt(h[1], 10) * 3600;
    if (m) total += parseInt(m[1], 10) * 60;
    if (s) total += parseInt(s[1], 10);
    return total > 0 ? total : NaN;
  }

  function getSeekSlider() {
    return document.querySelector('input[aria-label="Seek slider"]');
  }

  function getTime() {
    const slider = getSeekSlider();
    if (!slider) return null;

    const value = parseFloat(slider.value);
    const max = parseFloat(slider.max);
    const valueText = slider.getAttribute('aria-valuetext') || '';

    let currentSec = NaN;
    let durationSec = NaN;

    const parts = valueText.split(/\s+of\s+/i);
    if (parts.length === 2) {
      currentSec = parseAriaDuration(parts[0]);
      durationSec = parseAriaDuration(parts[1]);
    }

    if (!isFinite(durationSec) && isFinite(max) && max > 1000) {
      durationSec = max / 1000;
    }
    if (!isFinite(currentSec) && isFinite(value) && isFinite(max) && max > 0 && durationSec > 0) {
      currentSec = (value / max) * durationSec;
    }

    if (!isFinite(currentSec) || !isFinite(durationSec) || durationSec <= 0) return null;
    return { currentSec, durationSec, slider, max };
  }

  function seekTo(seconds) {
    const slider = getSeekSlider();
    const time = getTime();
    if (!slider || !time) return;
    const newValue = Math.max(0, Math.min(time.max, Math.round((seconds / time.durationSec) * time.max)));

    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(slider, String(newValue));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`${TAG} seek -> ${fmt(seconds)} (raw ${newValue})`);
  }

  // ---------- 1. Auto-insert timestamp into comment textbox ----------

  function isCommentTextbox(el) {
    return !!(el && el.matches && el.matches('[role="textbox"][aria-label="Comment draft"][contenteditable="true"]'));
  }

  function insertTimestamp(textbox) {
    if (!textbox || textbox.dataset.gdFioStamped === '1') return;
    if (!settings.autoStamp) return;

    const time = getTime();
    if (!time) {
      console.warn(`${TAG} cannot read seek slider; skipping insert`);
      return;
    }

    const existing = (textbox.textContent || '').replace(/​|﻿/g, '').trim();
    if (existing.length > 0) {
      console.log(`${TAG} textbox already has text (${JSON.stringify(existing.slice(0, 30))}); skipping`);
      textbox.dataset.gdFioStamped = '1';
      return;
    }

    textbox.dataset.gdFioStamped = '1';
    const text = `[${fmt(time.currentSec)}] `;
    console.log(`${TAG} inserting ${JSON.stringify(text)}`);

    try { textbox.focus(); } catch (_) {}

    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textbox);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) {}

    // If execCommand didn't put text in, try a synthetic paste.
    if (!ok || (textbox.textContent || '').indexOf(text.trim()) === -1) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        textbox.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
      } catch (_) {}
    }

    // Last-resort fallback: write text node and fire input event.
    if ((textbox.textContent || '').replace(/​|﻿/g, '').trim().length === 0) {
      while (textbox.firstChild) textbox.removeChild(textbox.firstChild);
      textbox.appendChild(document.createTextNode(text));
      const r2 = document.createRange();
      r2.selectNodeContents(textbox);
      r2.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r2);
      textbox.dispatchEvent(new InputEvent('input', {
        bubbles: true, inputType: 'insertText', data: text,
      }));
    }

    // Keep timestamp tracking the seek bar until the user types anything.
    startTimestampUpdater(textbox);
  }

  // Updater that rewrites [m:ss] in the open textbox while content is still
  // just the timestamp. Stops as soon as the user types past it.
  const TS_ONLY_REGEX = /^\s*\[\d{1,3}:\d{2}(?::\d{2})?\]\s*$/;
  let activeUpdaterTextbox = null;
  let activeUpdaterInterval = null;

  function stopTimestampUpdater() {
    if (activeUpdaterInterval) clearInterval(activeUpdaterInterval);
    activeUpdaterInterval = null;
    activeUpdaterTextbox = null;
  }

  function startTimestampUpdater(textbox) {
    stopTimestampUpdater();
    if (!settings.liveUpdate) return;
    activeUpdaterTextbox = textbox;
    activeUpdaterInterval = setInterval(() => {
      if (!textbox.isConnected) { stopTimestampUpdater(); return; }
      const content = (textbox.textContent || '').replace(/​|﻿/g, '');
      if (!TS_ONLY_REGEX.test(content)) { stopTimestampUpdater(); return; }

      const time = getTime();
      if (!time) return;
      const newTs = `[${fmt(time.currentSec)}] `;
      if (content === newTs) return;

      try {
        const wasFocused = document.activeElement === textbox;
        textbox.focus();
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(textbox);
        sel.removeAllRanges();
        sel.addRange(r);
        const ok = document.execCommand('insertText', false, newTs);
        if (!ok) {
          while (textbox.firstChild) textbox.removeChild(textbox.firstChild);
          textbox.appendChild(document.createTextNode(newTs));
          const r2 = document.createRange();
          r2.selectNodeContents(textbox);
          r2.collapse(false);
          sel.removeAllRanges();
          sel.addRange(r2);
          textbox.dispatchEvent(new InputEvent('input', {
            bubbles: true, inputType: 'insertText', data: newTs,
          }));
        }
        if (!wasFocused) textbox.blur();
      } catch (_) {}
    }, 250);
  }

  // Strategy A: focusin (Drive auto-focuses the textbox on open).
  document.addEventListener('focusin', (e) => {
    if (isCommentTextbox(e.target)) {
      // Slight delay so Drive's own init doesn't immediately overwrite.
      setTimeout(() => insertTimestamp(e.target), 30);
    }
  }, true);

  // Strategy B: MutationObserver for DOM additions.
  const domObs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (isCommentTextbox(node)) {
          setTimeout(() => insertTimestamp(node), 30);
          continue;
        }
        if (node.querySelectorAll) {
          node.querySelectorAll('[role="textbox"][aria-label="Comment draft"][contenteditable="true"]')
            .forEach((tb) => setTimeout(() => insertTimestamp(tb), 30));
        }
      }
    }
  });
  domObs.observe(document.documentElement, { childList: true, subtree: true });

  // Strategy C: cheap polling safety net.
  setInterval(() => {
    document.querySelectorAll('[role="textbox"][aria-label="Comment draft"][contenteditable="true"]')
      .forEach((tb) => {
        if (tb.dataset.gdFioStamped !== '1') insertTimestamp(tb);
      });
  }, 700);

  // ---------- 2. Clickable timestamps + timeline markers ----------

  function getSeekTrack() {
    return document.querySelector('[jsname="FPO71c"]') || document.querySelector('[jsname="grsJ5e"]');
  }

  function findCommentContainer(el) {
    // Drive's real comment card is the [role="listitem"] ancestor. Always prefer it.
    let p = el.parentElement;
    while (p && p !== document.body) {
      const role = p.getAttribute && p.getAttribute('role');
      if (role === 'listitem' || role === 'article') return p;
      p = p.parentElement;
    }
    // Fallback for non-Drive contexts: nearest block-level card-shaped ancestor.
    p = el.parentElement;
    while (p && p !== document.body) {
      const h = p.offsetHeight;
      const w = p.offsetWidth;
      if (h >= 36 && h <= 600 && w >= 140) {
        const cs = getComputedStyle(p);
        if (cs.display !== 'inline' && cs.display !== 'inline-block') return p;
      }
      p = p.parentElement;
    }
    return el.parentElement;
  }

  function shouldSkipForWrap(node) {
    let p = node.parentElement;
    while (p) {
      const t = p.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'NOSCRIPT') return true;
      if (p.isContentEditable || t === 'INPUT' || t === 'TEXTAREA') return true;
      if (p.classList && p.classList.contains('gd-fio-ts-link')) return true;
      p = p.parentElement;
    }
    return false;
  }

  function wrapTimestampsInTextNode(textNode, durationSec) {
    const text = textNode.nodeValue;
    TS_REGEX.lastIndex = 0;
    if (!TS_REGEX.test(text)) return;
    TS_REGEX.lastIndex = 0;

    const fragments = [];
    let lastIdx = 0;
    let m;
    while ((m = TS_REGEX.exec(text)) !== null) {
      if (m.index > lastIdx) fragments.push(document.createTextNode(text.slice(lastIdx, m.index)));
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      const c = m[3] !== undefined ? parseInt(m[3], 10) : null;
      const seconds = c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
      if (seconds < 0 || seconds > durationSec + 1) {
        fragments.push(document.createTextNode(m[0]));
      } else {
        const span = document.createElement('span');
        span.className = 'gd-fio-ts-link';
        span.textContent = m[0];
        span.dataset.gdFioSec = String(seconds);
        span.style.setProperty('--gd-fio-h', String(hueForSeconds(seconds)));
        span.title = `Jump to ${m[0]}`;
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          seekTo(seconds);
        });
        fragments.push(span);
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) fragments.push(document.createTextNode(text.slice(lastIdx)));

    const parent = textNode.parentNode;
    if (!parent) return;
    for (const frag of fragments) parent.insertBefore(frag, textNode);
    parent.removeChild(textNode);
  }

  function wrapAllTimestamps(durationSec) {
    if (!settings.clickableTimestamps) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const v = n.nodeValue;
        if (!v || v.indexOf('[') === -1) return NodeFilter.FILTER_REJECT;
        if (shouldSkipForWrap(n)) return NodeFilter.FILTER_REJECT;
        TS_REGEX.lastIndex = 0;
        if (!TS_REGEX.test(v)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const todo = [];
    let n;
    while ((n = walker.nextNode())) todo.push(n);
    for (const tn of todo) wrapTimestampsInTextNode(tn, durationSec);
  }

  function buildStampIndex() {
    // seconds -> { containers: Set<Element>, text: string, primaryTag: string|null }
    const index = new Map();
    document.querySelectorAll('.gd-fio-ts-link').forEach((span) => {
      const sec = parseInt(span.dataset.gdFioSec, 10);
      if (!isFinite(sec)) return;
      const container = findCommentContainer(span);
      let entry = index.get(sec);
      if (!entry) {
        entry = { containers: new Set(), text: '', primaryTag: null };
        index.set(sec, entry);
      }
      if (container) entry.containers.add(container);
      if (!entry.text && container) {
        entry.text = (container.textContent || '').trim().slice(0, 140);
      }
      if (!entry.primaryTag && container) {
        const tags = parseTags(container.textContent || '');
        if (tags.length > 0) entry.primaryTag = tags[0];
      }
    });
    return index;
  }

  function getFlashTarget(container) {
    // Drive's listitem has a transparent outer wrapper plus an inner white card.
    // Flashing the outer would only show as a thin ring; target the visible card.
    return container.querySelector('.wvGCSb-eKrold') || container;
  }

  function flashComments(containers, hue) {
    if (!containers || containers.size === 0) return;
    const arr = Array.from(containers);
    const first = arr[0];
    if (first && first.scrollIntoView) {
      try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    }
    for (const c of arr) {
      const target = getFlashTarget(c);
      if (typeof hue === 'number') target.style.setProperty('--gd-fio-h', String(hue));
      target.classList.remove('gd-fio-flash');
      void target.offsetWidth;
      target.classList.add('gd-fio-flash');
      setTimeout(() => target.classList.remove('gd-fio-flash'), 2600);
    }
  }

  function ensureMarkerLayer(track) {
    let layer = track.querySelector(`:scope > .${MARKER_LAYER_CLASS}`);
    if (!layer) {
      const cs = getComputedStyle(track);
      if (cs.position === 'static') track.style.position = 'relative';
      layer = document.createElement('div');
      layer.className = MARKER_LAYER_CLASS;
      track.appendChild(layer);
    }
    return layer;
  }

  function renderMarkers() {
    const time = getTime();
    if (!time) return;
    const track = getSeekTrack();
    if (!track || track.offsetWidth < 40) return;

    wrapAllTimestamps(time.durationSec);

    // If markers are disabled, clear any that exist and skip the rebuild.
    if (!settings.showMarkers) {
      track.querySelectorAll(`.${MARKER_CLASS}`).forEach((el) => el.remove());
      return;
    }

    const index = buildStampIndex();

    const layer = ensureMarkerLayer(track);
    const wantKeys = new Set();
    for (const sec of index.keys()) {
      if (visibleTsSet === null || visibleTsSet.has(sec)) {
        wantKeys.add(String(sec));
      }
    }

    layer.querySelectorAll(`.${MARKER_CLASS}`).forEach((el) => {
      if (!wantKeys.has(el.dataset.sec)) el.remove();
    });

    for (const [seconds, entry] of index.entries()) {
      // Skip filtered-out timestamps.
      if (visibleTsSet !== null && !visibleTsSet.has(seconds)) continue;

      const key = String(seconds);
      let marker = layer.querySelector(`.${MARKER_CLASS}[data-sec="${key}"]`);
      // When the comment has a tag, the tag's hue takes precedence over
      // the timestamp-derived hue so #fix #color etc. color-code the bar.
      const hue = entry.primaryTag ? hueForTag(entry.primaryTag) : hueForSeconds(seconds);
      if (!marker) {
        marker = document.createElement('div');
        marker.className = MARKER_CLASS;
        marker.dataset.sec = key;
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          handleMarkerClick(seconds, hue);
        });
        marker.addEventListener('pointerdown', (e) => e.stopPropagation());
        marker.addEventListener('mousedown', (e) => e.stopPropagation());
        layer.appendChild(marker);
      }
      marker.style.setProperty('--gd-fio-h', String(hue));
      marker.dataset.tag = entry.primaryTag || '';
      marker.style.left = `${(seconds / time.durationSec) * 100}%`;
      const tagSuffix = entry.primaryTag ? ` · #${entry.primaryTag}` : '';
      marker.title = `Jump to ${fmt(seconds)}${tagSuffix} — ${entry.text}`;
    }
  }

  // Default marker click → seek + flash the matching comment(s). Loop mode
  // overrides this when active.
  function handleMarkerClick(seconds, hue) {
    if (loopState.mode === 'set-start') {
      loopState.start = seconds;
      loopState.mode = 'set-end';
      setPanelStatus(`Loop start: ${fmt(seconds)} — click another marker for end`);
      updateLoopOverlay();
      return;
    }
    if (loopState.mode === 'set-end') {
      loopState.end = seconds;
      if (loopState.end < loopState.start) {
        const tmp = loopState.start; loopState.start = loopState.end; loopState.end = tmp;
      }
      activateLoop();
      return;
    }
    seekTo(seconds);
    const fresh = buildStampIndex().get(seconds);
    if (fresh) flashComments(fresh.containers, hue);
  }

  // Loop and Annotate handlers — set below in their feature sections.
  let toggleLoopMode = () => {};
  let toggleAnnotateMode = () => {};
  const loopState = { mode: 'idle', start: null, end: null, intervalId: null };
  let activateLoop = () => {};
  let updateLoopOverlay = () => {};

  // ---------- 5. Loop between two markers ----------

  toggleLoopMode = function () {
    const btn = document.querySelector('#gd-fio-panel [data-action="loop"]');
    if (loopState.mode === 'looping') {
      // Cancel an active loop.
      stopLoopInterval();
      loopState.mode = 'idle';
      loopState.start = null;
      loopState.end = null;
      setPanelStatus('');
      if (btn) btn.classList.remove('gd-fio-active');
      updateLoopOverlay();
      return;
    }
    if (loopState.mode === 'set-start' || loopState.mode === 'set-end') {
      loopState.mode = 'idle';
      loopState.start = null;
      loopState.end = null;
      setPanelStatus('');
      if (btn) btn.classList.remove('gd-fio-active');
      updateLoopOverlay();
      return;
    }
    // Enter set-start.
    loopState.mode = 'set-start';
    loopState.start = null;
    loopState.end = null;
    setPanelStatus('Click first marker for loop start', 'active');
    if (btn) btn.classList.add('gd-fio-active');
    updateLoopOverlay();
  };

  function stopLoopInterval() {
    if (loopState.intervalId) {
      clearInterval(loopState.intervalId);
      loopState.intervalId = null;
    }
  }

  activateLoop = function () {
    if (loopState.start == null || loopState.end == null) return;
    loopState.mode = 'looping';
    setPanelStatus(`Loop ${fmt(loopState.start)} → ${fmt(loopState.end)} · L to clear`, 'active');
    seekTo(loopState.start);
    stopLoopInterval();
    loopState.intervalId = setInterval(() => {
      const time = getTime();
      if (!time) return;
      // 0.25s slack at the end so we catch the boundary even at higher rates.
      if (time.currentSec >= loopState.end - 0.05 || time.currentSec < loopState.start - 1) {
        seekTo(loopState.start);
      }
    }, 250);
    updateLoopOverlay();
  };

  updateLoopOverlay = function () {
    const track = getSeekTrack();
    if (!track) return;
    let overlay = track.querySelector('.gd-fio-loop-overlay');
    const time = getTime();
    if (loopState.start == null || loopState.end == null || !time || !time.durationSec) {
      if (overlay) overlay.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'gd-fio-loop-overlay';
      track.appendChild(overlay);
    }
    const left = Math.max(0, (loopState.start / time.durationSec) * 100);
    const right = Math.min(100, (loopState.end / time.durationSec) * 100);
    overlay.style.left = `${left}%`;
    overlay.style.width = `${Math.max(0, right - left)}%`;
  };

  // ---------- 6. Drawing / annotation overlays ----------

  function getFileId() {
    const m = location.href.match(/\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function getPlayerWrapper() {
    return document.querySelector('.xpiQs');
  }

  function annotKey(fileId, seconds) {
    return `vidmark:annot:${fileId}:${Math.round(seconds * 100)}`;
  }

  async function saveAnnotation(seconds, dataUrl) {
    const fileId = getFileId();
    if (!fileId || !chrome || !chrome.storage || !chrome.storage.local) return;
    return new Promise((resolve) => {
      chrome.storage.local.set({
        [annotKey(fileId, seconds)]: { fileId, seconds, dataUrl, savedAt: Date.now() },
      }, resolve);
    });
  }

  function loadAnnotationsForFile() {
    const fileId = getFileId();
    if (!fileId || !chrome || !chrome.storage || !chrome.storage.local) {
      cachedAnnotations = [];
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (all) => {
        cachedAnnotations = Object.values(all || {}).filter((v) => v && v.fileId === fileId);
        resolve();
      });
    });
  }

  let cachedAnnotations = [];
  loadAnnotationsForFile();
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area === 'local') loadAnnotationsForFile();
    });
  }

  let annotateOverlayEl = null;
  let annotationDisplayEl = null;

  toggleAnnotateMode = function () {
    if (annotateOverlayEl) {
      closeAnnotateOverlay();
    } else {
      openAnnotateOverlay();
    }
  };

  // Make the function accessible to closeAnyMenus().
  function closeAnnotateOverlay() {
    if (annotateOverlayEl) {
      annotateOverlayEl.remove();
      annotateOverlayEl = null;
    }
    const btn = document.querySelector('#gd-fio-panel [data-action="annotate"]');
    if (btn) btn.classList.remove('gd-fio-active');
  }

  function openAnnotateOverlay() {
    const player = getPlayerWrapper();
    const time = getTime();
    if (!player || !time) {
      setPanelStatus('Open a video to annotate', 'active');
      setTimeout(() => setPanelStatus(''), 1800);
      return;
    }
    // Pause via the play/pause button if currently playing.
    const pauseBtn = document.querySelector('[role="button"][aria-label^="Pause"], button[aria-label^="Pause"]');
    if (pauseBtn) clickLikeUser(pauseBtn);

    const overlay = document.createElement('div');
    overlay.className = 'gd-fio-annotate-overlay';

    const canvas = document.createElement('canvas');
    canvas.className = 'gd-fio-annotate-canvas';
    overlay.appendChild(canvas);

    const toolbar = document.createElement('div');
    toolbar.className = 'gd-fio-annotate-toolbar';
    toolbar.innerHTML = `
      <span class="gd-fio-annot-label">Annotating ${fmt(time.currentSec)}</span>
      <label class="gd-fio-annot-color">
        <span class="gd-fio-annot-swatch"></span>
        <input type="color" data-action="color" value="#ff3838">
      </label>
      <button type="button" data-action="size">●</button>
      <button type="button" data-action="undo">Undo</button>
      <button type="button" data-action="clear">Clear</button>
      <button type="button" data-action="cancel">Cancel</button>
      <button type="button" data-action="save" class="primary">Save</button>
    `;
    overlay.appendChild(toolbar);

    const cs = getComputedStyle(player);
    if (cs.position === 'static') player.style.position = 'relative';
    player.appendChild(overlay);

    function resizeCanvas() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      redraw();
    }

    let color = '#ff3838';
    let lineWidth = 4;
    let drawing = false;
    const strokes = [];
    let currentStroke = [];
    const ctx = canvas.getContext('2d');

    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function redraw() {
      const w = canvas.width / (window.devicePixelRatio || 1);
      const h = canvas.height / (window.devicePixelRatio || 1);
      ctx.clearRect(0, 0, w, h);
      for (const s of strokes) {
        if (s.length < 1) continue;
        ctx.strokeStyle = s[0].color;
        ctx.lineWidth = s[0].lineWidth;
        ctx.beginPath();
        ctx.moveTo(s[0].x, s[0].y);
        for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
        ctx.stroke();
      }
    }

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      drawing = true;
      const p = pos(e);
      currentStroke = [{ x: p.x, y: p.y, color, lineWidth }];
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      currentStroke.push({ x: p.x, y: p.y, color, lineWidth });
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    canvas.addEventListener('pointerup', (e) => {
      if (!drawing) return;
      drawing = false;
      if (currentStroke.length > 0) {
        strokes.push(currentStroke);
        currentStroke = [];
      }
      try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    canvas.addEventListener('pointercancel', () => { drawing = false; currentStroke = []; });

    const swatch = toolbar.querySelector('.gd-fio-annot-swatch');
    swatch.style.background = color;
    toolbar.querySelector('[data-action="color"]').addEventListener('input', (e) => {
      color = e.target.value;
      swatch.style.background = color;
    });
    toolbar.querySelector('[data-action="size"]').addEventListener('click', (e) => {
      const sizes = [2, 4, 8, 14];
      lineWidth = sizes[(sizes.indexOf(lineWidth) + 1) % sizes.length];
      e.target.style.fontSize = `${10 + lineWidth}px`;
    });
    toolbar.querySelector('[data-action="undo"]').addEventListener('click', () => {
      strokes.pop();
      redraw();
    });
    toolbar.querySelector('[data-action="clear"]').addEventListener('click', () => {
      strokes.length = 0;
      redraw();
    });
    toolbar.querySelector('[data-action="cancel"]').addEventListener('click', closeAnnotateOverlay);
    toolbar.querySelector('[data-action="save"]').addEventListener('click', async () => {
      if (strokes.length === 0) {
        closeAnnotateOverlay();
        return;
      }
      const dataUrl = canvas.toDataURL('image/png');
      const t = getTime();
      const sec = t ? t.currentSec : time.currentSec;
      await saveAnnotation(sec, dataUrl);
      setPanelStatus(`Annotation saved at ${fmt(sec)}`, 'active');
      setTimeout(() => setPanelStatus(''), 2200);
      closeAnnotateOverlay();
    });

    annotateOverlayEl = overlay;
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const btn = document.querySelector('#gd-fio-panel [data-action="annotate"]');
    if (btn) btn.classList.add('gd-fio-active');
  }

  function tickAnnotationDisplay() {
    if (!settings.showAnnotations || annotateOverlayEl) {
      if (annotationDisplayEl) {
        annotationDisplayEl.remove();
        annotationDisplayEl = null;
      }
      return;
    }
    const time = getTime();
    if (!time) return;
    const match = cachedAnnotations.find((a) => Math.abs(a.seconds - time.currentSec) < 0.5);
    if (!match) {
      if (annotationDisplayEl) {
        annotationDisplayEl.remove();
        annotationDisplayEl = null;
      }
      return;
    }
    const player = getPlayerWrapper();
    if (!player) return;
    if (!annotationDisplayEl || !player.contains(annotationDisplayEl)) {
      annotationDisplayEl = document.createElement('img');
      annotationDisplayEl.className = 'gd-fio-annotation-display';
      annotationDisplayEl.alt = '';
      const cs = getComputedStyle(player);
      if (cs.position === 'static') player.style.position = 'relative';
      player.appendChild(annotationDisplayEl);
    }
    const key = `${match.seconds}:${match.savedAt}`;
    if (annotationDisplayEl.dataset.key !== key) {
      annotationDisplayEl.src = match.dataUrl;
      annotationDisplayEl.dataset.key = key;
    }
  }

  // ---------- 3. Sort + export panel ----------

  let currentSort = 'timecode';
  let currentTagFilter = '';
  let currentSearch = '';
  let visibleTsSet = null; // null = no filter; Set<number> = only these seconds
  let listParent = null;
  let lastItemCount = -1;
  let lastSortKey = '';
  let lastTsLinkCount = -1;

  function collectAllTags() {
    const tags = new Set();
    document.querySelectorAll('[role="listitem"]').forEach((el) => {
      const text = el.textContent || '';
      for (const t of parseTags(text)) tags.add(t);
    });
    return Array.from(tags).sort();
  }

  function commentMatchesFilters(meta) {
    if (currentTagFilter) {
      if (!meta.tags || !meta.tags.includes(currentTagFilter)) return false;
    }
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      const hay = `${meta.body || ''} ${meta.author || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function findListParent() {
    // Cache hit only if the cached parent still contains listitems.
    // Folder-view previews keep stale containers around when navigating
    // between videos.
    if (listParent && document.contains(listParent) && listParent.querySelector('[role="listitem"]')) {
      return listParent;
    }
    listParent = null;

    // Prefer a list inside the comments dialog (avoids matching the file
    // grid in folder views, which also uses [role="list"]).
    const dialog = getCommentsDialog();
    if (dialog) {
      const scoped = dialog.querySelectorAll('[role="list"]');
      for (const list of scoped) {
        if (list.querySelector(':scope > [role="listitem"]')) {
          listParent = list;
          return listParent;
        }
      }
    }

    // Drive's comments panel uses [role="list"] containing [role="listitem"].
    const lists = document.querySelectorAll('[role="list"]');
    for (const list of lists) {
      if (list.querySelector(':scope > [role="listitem"]')) {
        listParent = list;
        return listParent;
      }
    }

    // Fallback: common parent of detected comment containers.
    const fromLinks = new Set();
    document.querySelectorAll('.gd-fio-ts-link').forEach((span) => {
      const c = findCommentContainer(span);
      if (c) fromLinks.add(c);
    });
    if (fromLinks.size === 0) return null;
    const counts = new Map();
    for (const c of fromLinks) {
      const p = c.parentElement;
      if (!p) continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = null, bestN = 0;
    for (const [p, n] of counts.entries()) {
      if (n > bestN) { best = p; bestN = n; }
    }
    listParent = best;
    return listParent;
  }

  function getCommentItems() {
    const parent = findListParent();
    if (!parent) return [];
    if (parent.getAttribute && parent.getAttribute('role') === 'list') {
      return Array.from(parent.querySelectorAll(':scope > [role="listitem"]'));
    }
    return Array.from(parent.children).filter((c) => {
      if (!(c instanceof HTMLElement)) return false;
      if (c.id === 'gd-fio-panel') return false;
      if (c.classList && c.classList.contains('gd-fio-panel')) return false;
      if (c.offsetHeight < 24) return false;
      const txt = (c.textContent || '').trim();
      return txt.length >= 4;
    });
  }

  function extractCommentMeta(el) {
    // Author — Drive exposes [data-name="..."] on avatar + label, and aria-label on the listitem.
    let author = '';
    const nameEl = el.querySelector('[data-name]');
    if (nameEl) author = (nameEl.getAttribute('data-name') || '').trim();
    if (!author) {
      const aria = el.getAttribute('aria-label') || '';
      const m = /Author\s+(.+?)(?:\.|$)/i.exec(aria);
      if (m) author = m[1].trim();
    }

    // Seconds — minimum across all wrapped timestamp links inside this comment.
    let seconds = null;
    el.querySelectorAll('.gd-fio-ts-link').forEach((span) => {
      const s = parseInt(span.dataset.gdFioSec, 10);
      if (isFinite(s) && (seconds === null || s < seconds)) seconds = s;
    });

    // Body — Drive's specific class for the comment body (standalone viewer
    // and folder-view variants), with fallback to full text content.
    let body = '';
    const bodyEl = el.querySelector('.wvGCSb-eKrold-qJTHM, .Yk-eKrold-Sg, .Yk-eKrold-qJTHM');
    if (bodyEl) body = (bodyEl.textContent || '').replace(/\s+/g, ' ').trim();
    if (!body) {
      body = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (author && body.toLowerCase().startsWith(author.toLowerCase())) {
        body = body.slice(author.length).trim();
      }
    }

    // Fallback: if no wrapped ts-link was found (e.g. the timestamp exceeds
    // the current video's duration so wrapAllTimestamps rejected it), parse
    // the first [m:ss] directly from the body text so sort still works.
    if (seconds === null) {
      const m = body.match(/\[(\d{1,3}):(\d{2})(?::(\d{2}))?\]/);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        const c = m[3] !== undefined ? parseInt(m[3], 10) : null;
        seconds = c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
      }
    }

    // The body still contains the leading "[m:ss]" since the timestamp span lives
    // inside the comment text. Strip it — the export header already shows the time.
    body = body.replace(/^\s*\[\d{1,3}:\d{2}(?::\d{2})?\]\s*/, '').trim();

    // Resolved — Drive shows a "Reopen discussion" button on resolved comments.
    const resolved = !!el.querySelector('[aria-label*="Reopen" i], [data-tooltip*="Reopen" i]');

    // #tags from the comment body (e.g. #fix #color #audio).
    const tags = parseTags(body);

    return { author, seconds, body, resolved, tags };
  }

  function applySort(force) {
    const parent = findListParent();
    if (!parent) return;
    const items = getCommentItems();
    if (items.length === 0) return;

    const tsLinkCount = document.querySelectorAll('.gd-fio-ts-link').length;
    // Filter state is part of the sort key so re-applying picks up changes.
    const filterKey = `${currentSort}|${currentTagFilter}|${currentSearch}`;
    if (!force && filterKey === lastSortKey && items.length === lastItemCount && tsLinkCount === lastTsLinkCount) return;
    lastSortKey = filterKey;
    lastItemCount = items.length;
    lastTsLinkCount = tsLinkCount;

    // Drive's original `top: NNNpx` per item was a virtualized scroll offset,
    // not header-clearance — using it as padding pushed the comments way down.
    // A small fixed top padding is enough to keep comments below Drive's
    // panel header without leaving a huge empty band.
    // Push comments down enough to clear our floating Sort/Hide/Export panel.
    if (parent.dataset.gdFioPaddingCaptured !== '1') {
      parent.style.paddingTop = '100px';
      parent.dataset.gdFioPaddingCaptured = '1';
    }

    // Override Drive's absolute positioning on the listitems via a class.
    parent.classList.add('gd-fio-sort-active');

    items.forEach((el, i) => {
      if (!el.dataset.gdFioOrigIdx) el.dataset.gdFioOrigIdx = String(i);
    });

    const data = items.map((el) => {
      const meta = extractCommentMeta(el);
      return { el, origIdx: parseInt(el.dataset.gdFioOrigIdx, 10) || 0, ...meta };
    });

    // Apply tag filter + search before sort: filtered-out comments are hidden
    // entirely, and their timeline markers are also hidden via visibleTsSet.
    const filterActive = currentTagFilter !== '' || currentSearch !== '';
    const passes = (d) => commentMatchesFilters(d);
    let visible = filterActive ? data.filter(passes) : data.slice();
    let hidden = filterActive ? data.filter((d) => !passes(d)) : [];

    if (currentSort === 'timecode') {
      visible.sort((a, b) => {
        const sa = a.seconds === null ? Infinity : a.seconds;
        const sb = b.seconds === null ? Infinity : b.seconds;
        if (sa !== sb) return sa - sb;
        return a.origIdx - b.origIdx;
      });
    } else if (currentSort === 'oldest') {
      visible.sort((a, b) => a.origIdx - b.origIdx);
    } else if (currentSort === 'newest') {
      visible.sort((a, b) => b.origIdx - a.origIdx);
    } else if (currentSort === 'commenter') {
      visible.sort((a, b) => {
        const cmp = (a.author || '').localeCompare(b.author || '', undefined, { sensitivity: 'base' });
        return cmp !== 0 ? cmp : a.origIdx - b.origIdx;
      });
    } else if (currentSort === 'completed') {
      const onlyResolved = visible.filter((d) => d.resolved);
      hidden = hidden.concat(visible.filter((d) => !d.resolved));
      visible = onlyResolved.sort((a, b) => a.origIdx - b.origIdx);
    }

    visible.forEach((d, i) => {
      d.el.style.order = String(i + 1);
      d.el.style.display = '';
    });
    hidden.forEach((d) => { d.el.style.display = 'none'; });

    // Defensive: also physically reorder the listitems in the DOM. Drive's
    // folder-view preview sometimes keeps absolute positioning that we can't
    // fully override with CSS, so flex `order` alone has no visible effect.
    // Appending each in sort order moves them visually regardless of layout.
    try {
      for (const d of visible) {
        if (d.el.parentElement === parent) parent.appendChild(d.el);
      }
    } catch (_) {}

    // Build the set of seconds whose markers should remain visible. null when
    // no filter is active so markers all show by default.
    if (filterActive || currentSort === 'completed') {
      visibleTsSet = new Set();
      for (const d of visible) if (d.seconds !== null) visibleTsSet.add(d.seconds);
    } else {
      visibleTsSet = null;
    }
  }

  // ---------- Export pipeline ----------

  function getExportContext() {
    const items = getCommentItems();
    const data = items.map(extractCommentMeta);
    data.sort((a, b) => {
      const sa = a.seconds === null ? Infinity : a.seconds;
      const sb = b.seconds === null ? Infinity : b.seconds;
      return sa - sb;
    });
    const title = (document.title || 'Drive video').replace(/\s*-\s*Google Drive\s*$/i, '');
    const time = getTime();
    return {
      title,
      source: location.href,
      exportedAt: new Date(),
      durationSec: time && time.durationSec ? time.durationSec : null,
      data,
    };
  }

  function downloadFile(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function makeFilename(extension, ctx) {
    const stamp = ctx.exportedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safe = (ctx.title || 'comments').replace(/[^a-z0-9-_]/gi, '_').slice(0, 40) || 'comments';
    return `vidmark-${safe}-${stamp}.${extension}`;
  }

  function escapeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function fmtSrtTime(seconds) {
    const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
  }

  function fmtVttTime(seconds) {
    return fmtSrtTime(seconds).replace(',', '.');
  }

  function fmtEdlTime(seconds, fps) {
    const total = Math.floor(seconds);
    const frames = Math.min(fps - 1, Math.round((seconds - total) * fps));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
  }

  function generateTxt(ctx) {
    const lines = [];
    lines.push(`Comments — ${ctx.title}`);
    lines.push(`Source: ${ctx.source}`);
    lines.push(`Exported: ${ctx.exportedAt.toString()}`);
    lines.push(`Count: ${ctx.data.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const d of ctx.data) {
      const ts = d.seconds !== null ? `[${fmt(d.seconds)}]` : '[--:--]';
      const author = d.author || 'Unknown';
      const status = d.resolved ? ' (resolved)' : '';
      lines.push(`${author}${status}`);
      lines.push(d.body ? `${ts} ${d.body}` : ts);
      lines.push('');
    }
    return lines.join('\n');
  }

  function generateMarkdown(ctx) {
    const lines = [];
    lines.push(`# Comments — ${ctx.title}`);
    lines.push('');
    lines.push(`- **Source:** ${ctx.source}`);
    lines.push(`- **Exported:** ${ctx.exportedAt.toLocaleString()}`);
    lines.push(`- **Count:** ${ctx.data.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const d of ctx.data) {
      const ts = d.seconds !== null ? `[${fmt(d.seconds)}]` : '[--:--]';
      const author = d.author || 'Unknown';
      const status = d.resolved ? ' _(resolved)_' : '';
      lines.push(`### ${ts} — ${author}${status}`);
      lines.push('');
      if (d.body) lines.push(d.body);
      lines.push('');
    }
    return lines.join('\n');
  }

  function generateCsv(ctx) {
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const str = String(v);
      return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };
    const rows = [['Timestamp', 'Seconds', 'Author', 'Comment', 'Resolved']];
    for (const d of ctx.data) {
      const ts = d.seconds !== null ? fmt(d.seconds) : '';
      rows.push([ts, d.seconds == null ? '' : d.seconds, d.author || '', d.body || '', d.resolved ? 'true' : 'false']);
    }
    return rows.map((r) => r.map(escape).join(',')).join('\n');
  }

  function generateJson(ctx) {
    return JSON.stringify({
      title: ctx.title,
      source: ctx.source,
      exportedAt: ctx.exportedAt.toISOString(),
      durationSec: ctx.durationSec,
      count: ctx.data.length,
      comments: ctx.data.map((d) => ({
        timestamp: d.seconds !== null ? fmt(d.seconds) : null,
        seconds: d.seconds,
        author: d.author,
        body: d.body,
        resolved: d.resolved,
      })),
    }, null, 2);
  }

  function generateSrt(ctx) {
    const lines = [];
    let i = 1;
    for (const d of ctx.data) {
      if (d.seconds === null) continue;
      const start = d.seconds;
      const end = ctx.durationSec ? Math.min(start + 3, ctx.durationSec) : start + 3;
      lines.push(String(i++));
      lines.push(`${fmtSrtTime(start)} --> ${fmtSrtTime(end)}`);
      lines.push(`${d.author || 'Unknown'}: ${d.body || ''}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function generateVtt(ctx) {
    const lines = ['WEBVTT', ''];
    for (const d of ctx.data) {
      if (d.seconds === null) continue;
      const start = d.seconds;
      const end = ctx.durationSec ? Math.min(start + 3, ctx.durationSec) : start + 3;
      lines.push(`${fmtVttTime(start)} --> ${fmtVttTime(end)}`);
      lines.push(`${d.author || 'Unknown'}: ${d.body || ''}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  function generateFcpxml(ctx) {
    // Final Cut Pro X / Adobe Premiere can both import FCPXML.
    // Markers are placed on a synthetic gap clip the same length as the source.
    const duration = Math.ceil(ctx.durationSec || 3600);
    const markers = ctx.data
      .filter((d) => d.seconds !== null && d.seconds < duration)
      .map((d) => {
        const value = `${d.author || 'Unknown'}: ${d.body || ''}`;
        return `        <marker start="${d.seconds}s" duration="1/30s" value="${escapeXml(value)}"${d.resolved ? ' completed="1"' : ''}/>`;
      })
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r1" name="FFVideoFormat1080p2997" frameDuration="1001/30000s" width="1920" height="1080"/>
  </resources>
  <library>
    <event name="VidMark — ${escapeXml(ctx.title)}">
      <project name="${escapeXml(ctx.title)} comments">
        <sequence format="r1" duration="${duration}s">
          <spine>
            <gap name="VidMark Comments" offset="0s" duration="${duration}s">
${markers}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;
  }

  function generateEdl(ctx) {
    // CMX 3600 EDL with marker comments — DaVinci Resolve, Avid, and most NLEs accept this.
    const fps = 30;
    const safe = (ctx.title || 'VidMark').replace(/[^A-Z0-9 _-]/gi, '_').slice(0, 60).toUpperCase();
    const lines = [];
    lines.push(`TITLE: ${safe}`);
    lines.push('FCM: NON-DROP FRAME');
    lines.push('');
    let i = 1;
    for (const d of ctx.data) {
      if (d.seconds === null) continue;
      const tcIn = fmtEdlTime(d.seconds, fps);
      const tcOut = fmtEdlTime(d.seconds + 1 / fps, fps);
      const num = String(i).padStart(3, '0');
      lines.push(`${num}  001      V     C        ${tcIn} ${tcOut} ${tcIn} ${tcOut}`);
      lines.push(`* FROM CLIP NAME: ${safe}`);
      const status = d.resolved ? ' (resolved)' : '';
      lines.push(`* COMMENT: ${(d.author || 'Unknown')}${status}: ${(d.body || '').replace(/\r?\n/g, ' ')}`);
      lines.push('');
      i++;
    }
    return lines.join('\n');
  }

  function generateHtml(ctx) {
    const rows = ctx.data.map((d) => {
      const ts = d.seconds !== null ? fmt(d.seconds) : '--:--';
      const author = d.author || 'Unknown';
      const body = d.body || '';
      const status = d.resolved ? '<span class="resolved">resolved</span>' : '';
      return `      <tr>
        <td class="ts">${ts}</td>
        <td class="author">${escapeXml(author)} ${status}</td>
        <td class="body">${escapeXml(body)}</td>
      </tr>`;
    }).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>VidMark — ${escapeXml(ctx.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; max-width: 900px; margin: 40px auto; padding: 0 24px; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  .meta { color: #666; font-size: 13px; margin-bottom: 24px; }
  .meta div { margin: 2px 0; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 12px 8px; text-align: left; vertical-align: top; border-bottom: 1px solid #e5e5e5; }
  th { background: #f7f7f7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
  td.ts { font-family: 'SF Mono', Menlo, monospace; color: #1a73e8; font-weight: 500; white-space: nowrap; width: 80px; }
  td.author { font-weight: 500; white-space: nowrap; width: 200px; }
  .resolved { background: #d4edda; color: #155724; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: normal; margin-left: 4px; }
  .print-instruction { background: #fff8e1; border-left: 4px solid #ffcc00; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px; font-size: 14px; }
  .print-instruction button { background: #1a73e8; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; margin-left: 8px; font-size: 13px; }
  @media print { .print-instruction { display: none; } body { margin: 0; padding: 0 16px; } }
</style>
</head>
<body>
<div class="print-instruction">
  Use your browser's print dialog to save this as a PDF.
  <button onclick="window.print()">Print / Save as PDF</button>
</div>
<h1>${escapeXml(ctx.title)}</h1>
<div class="meta">
  <div><strong>Source:</strong> <a href="${escapeXml(ctx.source)}">${escapeXml(ctx.source)}</a></div>
  <div><strong>Exported:</strong> ${escapeXml(ctx.exportedAt.toLocaleString())}</div>
  <div><strong>Comments:</strong> ${ctx.data.length}</div>
</div>
<table>
  <thead><tr><th>Time</th><th>Author</th><th>Comment</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>
</body>
</html>`;
  }

  function exportAs(format) {
    const ctx = getExportContext();
    if (ctx.data.length === 0) {
      alert('No comments found to export. Open Drive\'s comments panel first.');
      return;
    }
    switch (format) {
      case 'txt':    return downloadFile(generateTxt(ctx),      'text/plain',          makeFilename('txt', ctx));
      case 'md':     return downloadFile(generateMarkdown(ctx), 'text/markdown',       makeFilename('md', ctx));
      case 'csv':    return downloadFile(generateCsv(ctx),      'text/csv',            makeFilename('csv', ctx));
      case 'json':   return downloadFile(generateJson(ctx),     'application/json',    makeFilename('json', ctx));
      case 'srt':    return downloadFile(generateSrt(ctx),      'application/x-subrip', makeFilename('srt', ctx));
      case 'vtt':    return downloadFile(generateVtt(ctx),      'text/vtt',            makeFilename('vtt', ctx));
      case 'fcpxml': return downloadFile(generateFcpxml(ctx),   'application/xml',     makeFilename('fcpxml', ctx));
      case 'edl':    return downloadFile(generateEdl(ctx),      'text/plain',          makeFilename('edl', ctx));
      case 'html': {
        const blob = new Blob([generateHtml(ctx)], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return;
      }
      default:
        console.warn(`${TAG} unknown export format: ${format}`);
    }
  }

  // Backwards-compatible alias for the old "Export .txt" panel button.
  function exportComments() { exportAs('txt'); }

  let commentsHidden = false;

  function getCommentsDialog() {
    // First selector: standalone Drive video viewer.
    // Second selector: video preview inside a folder.
    return document.querySelector('.ndfHFb-c4YZDc-qwU8Me-b0t70b-haAclf, .a-b-Yk-hj');
  }

  function computeExpandedPlayerVars() {
    // Drive's player container is `.ndfHFb-c4YZDc-aTv5jf` with inline
    // pixel left/top/width/height. We compute a 16:9 box that fills the
    // viewport (minus margins for top toolbar + bottom controls) and
    // expose it as CSS variables that the !important rule consumes.
    const sideMargin = 32;
    const topOffset = 100;
    const bottomOffset = 60;
    const aw = Math.max(640, window.innerWidth - sideMargin * 2);
    const ah = Math.max(360, window.innerHeight - topOffset - bottomOffset);
    let w = aw;
    let h = (w * 9) / 16;
    if (h > ah) { h = ah; w = (h * 16) / 9; }
    const left = Math.max(sideMargin, (window.innerWidth - w) / 2);
    const top = Math.max(topOffset, (window.innerHeight - h) / 2 - 16);

    document.body.style.setProperty('--gd-fio-player-left', `${left}px`);
    document.body.style.setProperty('--gd-fio-player-top', `${top}px`);
    document.body.style.setProperty('--gd-fio-player-width', `${w}px`);
    document.body.style.setProperty('--gd-fio-player-height', `${h}px`);
  }

  function setCommentsHidden(hidden) {
    commentsHidden = hidden;
    const parent = findListParent();
    if (parent) parent.classList.toggle('gd-fio-comments-hidden', hidden);
    const dialog = getCommentsDialog();
    if (dialog) dialog.style.display = hidden ? 'none' : '';

    // Defensive sweep: directly toggle every comment-shaped listitem on the
    // page. Folder-view previews render comments through a different DOM
    // tree that the dialog selector can miss, so we also key off the
    // listitem itself (must look like a comment — has [data-name] author,
    // a wrapped ts-link, or aria-label mentioning "comment").
    document.querySelectorAll('[role="listitem"]').forEach((el) => {
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const looksLikeComment = !!(
        el.querySelector('[data-name]') ||
        el.querySelector('.gd-fio-ts-link') ||
        ariaLabel.includes('comment') ||
        ariaLabel.includes('author')
      );
      if (!looksLikeComment) return;
      if (hidden) {
        el.dataset.gdFioWasHidden = '1';
        el.style.setProperty('display', 'none', 'important');
      } else if (el.dataset.gdFioWasHidden === '1') {
        el.style.removeProperty('display');
        delete el.dataset.gdFioWasHidden;
      }
    });

    document.body.classList.toggle('gd-fio-video-expanded', hidden);
    if (hidden) computeExpandedPlayerVars();

    // Tell Drive to recompute internal layout (seek-bar track width, etc.).
    window.dispatchEvent(new Event('resize'));

    const btn = document.querySelector('[data-action="toggle-hide"]');
    if (btn) btn.textContent = hidden ? 'Show Comments' : 'Hide Comments';
  }

  // Keep the player sized correctly if the user resizes the window while expanded.
  window.addEventListener('resize', () => {
    if (commentsHidden) computeExpandedPlayerVars();
  });

  function buildPanel() {
    if (document.getElementById('gd-fio-panel')) return;
    const wrap = document.createElement('div');
    wrap.id = 'gd-fio-panel';
    wrap.className = 'gd-fio-panel';
    wrap.innerHTML = `
      <div class="gd-fio-panel-row">
        <span class="gd-fio-panel-label">Sort</span>
        <select class="gd-fio-panel-select" data-action="sort">
          <option value="timecode">Timecode</option>
          <option value="oldest">Oldest</option>
          <option value="newest">Newest</option>
          <option value="commenter">Commenter</option>
          <option value="completed">Completed</option>
        </select>
        <button type="button" class="gd-fio-panel-btn gd-fio-panel-btn-secondary" data-action="toggle-hide">Hide Comments</button>
        <div class="gd-fio-export-wrap">
          <button type="button" class="gd-fio-panel-btn" data-action="export-toggle">Export <span class="gd-fio-caret">▾</span></button>
          <div class="gd-fio-export-menu" data-action="export-menu" hidden>
            <div class="gd-fio-menu-section">Document</div>
            <button type="button" data-format="txt"><span>Plain text</span><span class="ext">.txt</span></button>
            <button type="button" data-format="md"><span>Markdown</span><span class="ext">.md</span></button>
            <button type="button" data-format="csv"><span>Spreadsheet</span><span class="ext">.csv</span></button>
            <button type="button" data-format="json"><span>JSON</span><span class="ext">.json</span></button>
            <button type="button" data-format="html"><span>Printable / PDF</span><span class="ext">.html</span></button>
            <div class="gd-fio-menu-section">Subtitles</div>
            <button type="button" data-format="srt"><span>SubRip</span><span class="ext">.srt</span></button>
            <button type="button" data-format="vtt"><span>WebVTT</span><span class="ext">.vtt</span></button>
            <div class="gd-fio-menu-section">Video editor</div>
            <button type="button" data-format="fcpxml"><span>Final Cut / Premiere</span><span class="ext">.fcpxml</span></button>
            <button type="button" data-format="edl"><span>DaVinci Resolve / EDL</span><span class="ext">.edl</span></button>
          </div>
        </div>
      </div>
      <div class="gd-fio-panel-row gd-fio-panel-row-2">
        <input type="search" class="gd-fio-search" placeholder="Search comments… (/)" data-action="search" autocomplete="off">
        <select class="gd-fio-panel-select gd-fio-tag-select" data-action="tag-filter" title="Filter by #tag">
          <option value="">All tags</option>
        </select>
      </div>
      <div class="gd-fio-panel-row gd-fio-panel-row-3">
        <button type="button" class="gd-fio-panel-btn gd-fio-panel-btn-secondary" data-action="loop">🔁 Loop</button>
        <button type="button" class="gd-fio-panel-btn gd-fio-panel-btn-secondary" data-action="annotate">✏️ Annotate</button>
        <span class="gd-fio-panel-status" data-action="status"></span>
      </div>
    `;
    document.body.appendChild(wrap);

    const select = wrap.querySelector('[data-action="sort"]');
    select.value = currentSort;
    select.addEventListener('change', () => {
      currentSort = select.value;
      applySort(true);
    });

    wrap.querySelector('[data-action="toggle-hide"]').addEventListener('click', () => {
      setCommentsHidden(!commentsHidden);
    });

    const exportToggle = wrap.querySelector('[data-action="export-toggle"]');
    const exportMenu = wrap.querySelector('[data-action="export-menu"]');
    exportToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.hidden = !exportMenu.hidden;
    });
    exportMenu.querySelectorAll('[data-format]').forEach((b) => {
      b.addEventListener('click', () => {
        exportAs(b.dataset.format);
        exportMenu.hidden = true;
      });
    });
    document.addEventListener('click', (e) => {
      if (!exportMenu.hidden && !wrap.contains(e.target)) exportMenu.hidden = true;
    });

    // ---------- Search input ----------
    const searchInput = wrap.querySelector('[data-action="search"]');
    let searchDebounce = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        currentSearch = searchInput.value.trim();
        applySort(true);
        scheduleRender();
      }, 120);
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        currentSearch = '';
        applySort(true);
        scheduleRender();
        searchInput.blur();
      }
    });

    // ---------- Tag filter dropdown ----------
    const tagSelect = wrap.querySelector('[data-action="tag-filter"]');
    tagSelect.addEventListener('change', () => {
      currentTagFilter = tagSelect.value;
      applySort(true);
      scheduleRender();
    });

    // ---------- Loop button ----------
    wrap.querySelector('[data-action="loop"]').addEventListener('click', toggleLoopMode);

    // ---------- Annotate button ----------
    wrap.querySelector('[data-action="annotate"]').addEventListener('click', toggleAnnotateMode);
  }

  function refreshTagFilter() {
    const select = document.querySelector('#gd-fio-panel [data-action="tag-filter"]');
    if (!select) return;
    const tags = collectAllTags();
    const current = select.value;
    const desiredTagSet = new Set(tags);
    const existingTagSet = new Set(
      Array.from(select.options).map((o) => o.value).filter((v) => v !== '')
    );
    let changed = tags.length !== existingTagSet.size;
    if (!changed) {
      for (const t of tags) if (!existingTagSet.has(t)) { changed = true; break; }
    }
    if (!changed) return;
    select.innerHTML = '<option value="">All tags</option>';
    for (const tag of tags) {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = `#${tag}`;
      select.appendChild(opt);
    }
    select.value = desiredTagSet.has(current) ? current : '';
    if (select.value !== currentTagFilter) {
      currentTagFilter = select.value;
      applySort(true);
    }
  }

  function setPanelStatus(message, kind) {
    const el = document.querySelector('#gd-fio-panel [data-action="status"]');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.kind = kind || '';
  }

  function tickPanel() {
    const items = getCommentItems();
    let panel = document.getElementById('gd-fio-panel');

    // If the user disabled the floating panel in settings, keep it hidden.
    if (!settings.showFloatingPanel) {
      if (panel) panel.style.display = 'none';
      return;
    }

    // Keep our panel visible if there are comments OR if the user has hidden
    // them (so they can click "Show Comments" to bring them back).
    const shouldShow = items.length > 0 || commentsHidden;
    if (!shouldShow) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!panel) { buildPanel(); panel = document.getElementById('gd-fio-panel'); }
    if (panel) panel.style.display = '';
    if (items.length > 0) applySort(false);
    refreshTagFilter();

    // Fallback: if Drive's toggle wasn't found and we're hiding via listitem class,
    // keep that class applied across re-renders.
    if (commentsHidden) {
      const parent = findListParent();
      if (parent && !parent.classList.contains('gd-fio-comments-hidden')) {
        parent.classList.add('gd-fio-comments-hidden');
      }
    }
  }

  // ---------- 4. Auto-reopen comment input after posting ----------

  const BLOCKED_LABELS = new Set([
    'post comment', 'reply', 'reply to comment', 'discard comment', 'cancel',
    'mark as resolved', 'mark as resolved and hide discussion',
    'reopen', 'reopen discussion', 'more options', 'more option',
    'edit comment', 'delete comment', 'link to this comment', 'copy link',
  ]);

  function isBlockedAction(label) {
    if (!label) return false;
    if (BLOCKED_LABELS.has(label)) return true;
    if (label.includes('post')) return true;
    if (label.includes('reply')) return true;
    if (label.includes('discard')) return true;
    if (label.includes('cancel')) return true;
    if (label.includes('resolve')) return true;
    if (label.includes('reopen')) return true;
    if (label.includes('more option')) return true;
    if (label.includes('edit') || label.includes('delete')) return true;
    return false;
  }

  function findAddCommentButton() {
    // Strategy 1: visible text "Comment" inside a [role="toolbar"].
    const toolbars = document.querySelectorAll('[role="toolbar"]');
    for (const tb of toolbars) {
      const buttons = tb.querySelectorAll('button, [role="button"]');
      for (const b of buttons) {
        if (b.getAttribute('aria-disabled') === 'true') continue;
        const al = (b.getAttribute('aria-label') || '').toLowerCase().trim();
        if (isBlockedAction(al)) continue;
        const text = (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim();
        if (text === 'Comment' || text === '+ Comment' || text === 'Add a comment') {
          return b;
        }
      }
    }

    // Strategy 2: aria-label / tooltip match anywhere.
    const candidates = document.querySelectorAll('button, [role="button"]');
    for (const c of candidates) {
      if (c.getAttribute('aria-disabled') === 'true') continue;
      const al = (c.getAttribute('aria-label') || '').toLowerCase().trim();
      const tt = (c.getAttribute('data-tooltip') || '').toLowerCase().trim();
      if (isBlockedAction(al) || isBlockedAction(tt)) continue;
      if (al === 'add a comment' || al === 'add comment' || tt === 'add a comment' || tt === 'add comment') return c;
      if ((al === 'comment' || tt === 'comment') && c.closest('[role="toolbar"]')) return c;
    }

    // Strategy 3: an aria-describedby tooltip element saying "Comment" / "Add a comment".
    const tipped = document.querySelectorAll('[aria-describedby]');
    for (const c of tipped) {
      if (!(c instanceof HTMLElement)) continue;
      if (c.getAttribute('aria-disabled') === 'true') continue;
      const al = (c.getAttribute('aria-label') || '').toLowerCase().trim();
      if (isBlockedAction(al)) continue;
      const tipId = c.getAttribute('aria-describedby');
      const tipEl = tipId ? document.getElementById(tipId) : null;
      const tipText = tipEl ? (tipEl.textContent || '').trim().toLowerCase() : '';
      if (tipText === 'comment' || tipText === 'add a comment' || tipText === 'add comment') {
        return c;
      }
    }

    return null;
  }

  function dumpToolbarButtons() {
    const out = [];
    document.querySelectorAll('[role="toolbar"] button, [role="toolbar"] [role="button"]').forEach((b) => {
      out.push({
        ariaLabel: b.getAttribute('aria-label'),
        tooltip: b.getAttribute('data-tooltip'),
        text: (b.innerText || b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        disabled: b.getAttribute('aria-disabled'),
      });
    });
    return out;
  }

  function clickLikeUser(el) {
    // Some Drive controls react to pointer/mouse events more reliably than `.click()`.
    try {
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 1, pointerType: 'mouse' }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {
      try { el.click(); } catch (__) {}
    }
  }

  function autoReopenAfterPost() {
    if (!settings.autoReopen) return;
    // Small delay so Drive can fully settle (dialog dismissed, toolbar enabled).
    setTimeout(() => {
      const btn = findAddCommentButton();
      if (btn) {
        console.log(`${TAG} clicking "+ Comment" button`, {
          ariaLabel: btn.getAttribute('aria-label'),
          tooltip: btn.getAttribute('data-tooltip'),
          text: (btn.innerText || btn.textContent || '').trim().slice(0, 60),
        });
        clickLikeUser(btn);
      } else {
        console.warn(`${TAG} could not find "+ Comment" button. Toolbar buttons present:`, dumpToolbarButtons());
      }
    }, 250);
  }

  // Primary trigger: watch the comments list for a new listitem being added.
  // Drive's Post Comment button doesn't reliably surface a click event to our
  // document-level listeners (jsaction-driven), so we detect the *result*
  // — a new comment appearing — instead.
  let baselineCommentCount = -1;
  let stableTicks = 0;
  let lastSeenCount = -1;
  let lastAutoReopenAt = 0;

  function tickAutoReopen() {
    const items = getCommentItems();
    const n = items.length;

    if (baselineCommentCount === -1) {
      if (n === lastSeenCount) {
        stableTicks++;
        if (stableTicks >= 2) {
          baselineCommentCount = n;
          console.log(`${TAG} auto-reopen baseline locked at ${n} comments`);
        }
      } else {
        stableTicks = 0;
        lastSeenCount = n;
      }
      return;
    }

    if (n > baselineCommentCount) {
      const now = Date.now();
      if (now - lastAutoReopenAt > 1500) {
        lastAutoReopenAt = now;
        console.log(`${TAG} comment count ${baselineCommentCount} -> ${n}, reopening editor`);
        autoReopenAfterPost();
      }
    }
    baselineCommentCount = n;

    // Attach a per-list MutationObserver for instant reaction (avoids the 1.5s tick wait).
    const parent = findListParent();
    if (parent && parent.dataset.gdFioListObs !== '1') {
      parent.dataset.gdFioListObs = '1';
      const obs = new MutationObserver((muts) => {
        if (baselineCommentCount === -1) return;
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue;
            const isItem = node.matches && node.matches('[role="listitem"]');
            if (isItem) {
              const now = Date.now();
              if (now - lastAutoReopenAt > 1500) {
                lastAutoReopenAt = now;
                console.log(`${TAG} listitem mutation, reopening editor`);
                autoReopenAfterPost();
              }
              return;
            }
          }
        }
      });
      obs.observe(parent, { childList: true });
    }
  }

  // Backup trigger: still listen for Post Comment clicks via multiple event
  // types in case Drive ever does dispatch one we can capture.
  ['click', 'pointerup', 'mouseup'].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      const post = e.target.closest && e.target.closest('[role="button"][aria-label="Post Comment"]');
      if (!post) return;
      if (post.getAttribute('aria-disabled') === 'true') return;
      const now = Date.now();
      if (now - lastAutoReopenAt < 1500) return;
      lastAutoReopenAt = now;
      console.log(`${TAG} Post Comment ${evt} detected (backup path)`);
      autoReopenAfterPost();
    }, true);
  });

  // ---------- Render loop ----------

  let renderRaf = null;
  function scheduleRender() {
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = null;
      // Only act when a video player is actually loaded. Drive folder pages
      // also use [role="list"] / [role="listitem"] (the file grid) which
      // would otherwise spawn our panel and cause the script to misbehave.
      if (!getSeekSlider()) {
        const panel = document.getElementById('gd-fio-panel');
        if (panel) panel.style.display = 'none';
        return;
      }
      try { renderMarkers(); } catch (e) { console.warn(`${TAG} render error`, e); }
      try { tickPanel(); } catch (e) { console.warn(`${TAG} panel error`, e); }
      try { tickAutoReopen(); } catch (e) { console.warn(`${TAG} auto-reopen tick error`, e); }
      try { tickAnnotationDisplay(); } catch (e) { console.warn(`${TAG} annotation tick error`, e); }
    });
  }

  setInterval(scheduleRender, 1500);
  window.addEventListener('resize', scheduleRender);
  setTimeout(scheduleRender, 800);

  // ---------- Keyboard shortcuts ----------

  function isInEditable(target) {
    if (!target) return false;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return true;
    let el = target;
    while (el) {
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  }

  function jumpToMarker(direction) {
    const time = getTime();
    if (!time) return;
    const all = Array.from(buildStampIndex().keys())
      .filter((s) => typeof s === 'number' && isFinite(s))
      .sort((a, b) => a - b);
    if (all.length === 0) return;
    const current = time.currentSec;
    let target;
    if (direction > 0) {
      target = all.find((s) => s > current + 0.5);
      if (target === undefined) target = all[0];
    } else {
      const reversed = all.slice().reverse();
      target = reversed.find((s) => s < current - 0.5);
      if (target === undefined) target = all[all.length - 1];
    }
    seekTo(target);
    const entry = buildStampIndex().get(target);
    if (entry) {
      const hue = entry.primaryTag ? hueForTag(entry.primaryTag) : hueForSeconds(target);
      flashComments(entry.containers, hue);
    }
  }

  function closeAnyMenus() {
    const exportMenu = document.querySelector('#gd-fio-panel [data-action="export-menu"]');
    if (exportMenu) exportMenu.hidden = true;
    if (loopState.mode === 'set-start' || loopState.mode === 'set-end') {
      loopState.mode = 'idle';
      loopState.start = null;
      loopState.end = null;
      setPanelStatus('Loop canceled');
      setTimeout(() => setPanelStatus(''), 1500);
      updateLoopOverlay();
    }
    if (typeof closeAnnotateOverlay === 'function') closeAnnotateOverlay();
  }

  document.addEventListener('keydown', (e) => {
    if (!settings.keyboardShortcuts) return;

    // Escape always works — closes menus, cancels modes.
    if (e.key === 'Escape') {
      closeAnyMenus();
      return;
    }

    // Slash focuses the search input from anywhere.
    if (e.key === '/' && !isInEditable(e.target)) {
      const search = document.querySelector('#gd-fio-panel [data-action="search"]');
      if (search) {
        e.preventDefault();
        search.focus();
        search.select();
      }
      return;
    }

    if (isInEditable(e.target)) return;

    // n — open a new comment at the current frame.
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const btn = findAddCommentButton();
      if (btn) {
        e.preventDefault();
        clickLikeUser(btn);
      }
      return;
    }

    // . — next marker
    if (e.key === '.' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      jumpToMarker(1);
      return;
    }

    // , — previous marker
    if (e.key === ',' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      jumpToMarker(-1);
      return;
    }

    // Cmd+E / Ctrl+E — open the floating panel's export dropdown.
    if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
      const exportMenu = document.querySelector('#gd-fio-panel [data-action="export-menu"]');
      if (exportMenu) {
        e.preventDefault();
        exportMenu.hidden = false;
      }
      return;
    }

    // l — toggle loop-set mode
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      toggleLoopMode();
      return;
    }
  }, true);

  // ---------- Popup messaging ----------

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return false;

      if (msg.type === 'VIDMARK_EXPORT') {
        try {
          exportAs(msg.format);
          sendResponse({ success: true });
        } catch (e) {
          console.error(`${TAG} export error`, e);
          sendResponse({ success: false, error: e && e.message ? e.message : 'Export failed' });
        }
        return true;
      }

      if (msg.type === 'VIDMARK_SETTINGS_CHANGED') {
        loadSettings();
        // Force a re-render so disabled-feature elements clean themselves up
        // (e.g. markers vanish, ts-link spans remain but stop being added).
        setTimeout(scheduleRender, 100);
        sendResponse({ success: true });
        return true;
      }

      return false;
    });
  }

  // Live-respond to settings changes from the popup without waiting for a message.
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const key of Object.keys(changes)) {
        if (key in settings) settings[key] = !!changes[key].newValue;
      }
      setTimeout(scheduleRender, 100);
    });
  }
})();
