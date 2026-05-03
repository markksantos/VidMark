const SETTINGS_KEYS = [
  'autoStamp',
  'liveUpdate',
  'autoReopen',
  'showMarkers',
  'clickableTimestamps',
  'showFloatingPanel',
];

// All settings default to true (opt-out model).
const SETTINGS_DEFAULTS = SETTINGS_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {});

const statusEl = document.getElementById('status');

function showStatus(message, kind = 'info', durationMs = 2400) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = 'status' + (kind === 'success' ? ' success' : kind === 'error' ? ' error' : '');
  if (durationMs > 0) {
    setTimeout(() => { statusEl.hidden = true; }, durationMs);
  }
}

// ---------- Tab navigation ----------
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.hidden = p.dataset.panel !== target;
    });
  });
});

// ---------- Export ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.querySelectorAll('.export-row').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const format = btn.dataset.format;
    const tab = await getActiveTab();
    if (!tab) {
      showStatus('No active tab. Open a Drive video first.', 'error');
      return;
    }
    if (!/^https:\/\/drive\.google\.com\//.test(tab.url || '')) {
      showStatus('Open a Google Drive video to export comments.', 'error');
      return;
    }
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'VIDMARK_EXPORT', format });
      if (response && response.success) {
        showStatus(`Exported as .${format}`, 'success', 1600);
        setTimeout(() => window.close(), 700);
      } else if (response && response.error) {
        showStatus(response.error, 'error');
      } else {
        showStatus('Export started.', 'success', 1200);
        setTimeout(() => window.close(), 700);
      }
    } catch (e) {
      showStatus('VidMark is not loaded on this page. Refresh the Drive tab and try again.', 'error');
    }
  });
});

// ---------- Settings ----------
async function loadSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEYS);
  for (const key of SETTINGS_KEYS) {
    const el = document.querySelector(`[data-setting="${key}"]`);
    if (!el) continue;
    el.checked = stored[key] === undefined ? SETTINGS_DEFAULTS[key] : !!stored[key];
  }
}

document.querySelectorAll('[data-setting]').forEach((input) => {
  input.addEventListener('change', async () => {
    const key = input.dataset.setting;
    await chrome.storage.sync.set({ [key]: input.checked });
    const tab = await getActiveTab();
    if (tab && /^https:\/\/drive\.google\.com\//.test(tab.url || '')) {
      chrome.tabs.sendMessage(tab.id, { type: 'VIDMARK_SETTINGS_CHANGED' }).catch(() => {});
    }
  });
});

// ---------- About ----------
const aboutVersionEl = document.getElementById('aboutVersion');
if (aboutVersionEl && chrome.runtime.getManifest) {
  const m = chrome.runtime.getManifest();
  aboutVersionEl.textContent = `${m.name} · v${m.version}`;
}

loadSettings();
