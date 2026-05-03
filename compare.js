function extractFileId(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function load() {
  const left = extractFileId(document.getElementById('leftUrl').value);
  const right = extractFileId(document.getElementById('rightUrl').value);
  if (!left || !right) {
    alert('Could not parse one or both URLs. Use a Drive video URL or a file ID.');
    return;
  }
  document.getElementById('leftFrame').src = `https://drive.google.com/file/d/${left}/preview`;
  document.getElementById('rightFrame').src = `https://drive.google.com/file/d/${right}/preview`;
  document.getElementById('leftLabel').textContent = left;
  document.getElementById('rightLabel').textContent = right;
  document.getElementById('players').hidden = false;
  try {
    sessionStorage.setItem('vidmark.compare.left', left);
    sessionStorage.setItem('vidmark.compare.right', right);
  } catch (_) {}
}

document.getElementById('loadBtn').addEventListener('click', load);

document.getElementById('swapBtn').addEventListener('click', () => {
  const l = document.getElementById('leftUrl');
  const r = document.getElementById('rightUrl');
  const tmp = l.value;
  l.value = r.value;
  r.value = tmp;
});

document.getElementById('clearBtn').addEventListener('click', () => {
  document.getElementById('leftUrl').value = '';
  document.getElementById('rightUrl').value = '';
  document.getElementById('leftFrame').src = '';
  document.getElementById('rightFrame').src = '';
  document.getElementById('players').hidden = true;
  try {
    sessionStorage.removeItem('vidmark.compare.left');
    sessionStorage.removeItem('vidmark.compare.right');
  } catch (_) {}
});

['leftUrl', 'rightUrl'].forEach((id) => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') load();
  });
});

// Direct-link via URL params: compare.html?left=ID1&right=ID2
const params = new URLSearchParams(location.search);
if (params.get('left') || params.get('right')) {
  document.getElementById('leftUrl').value = params.get('left') || '';
  document.getElementById('rightUrl').value = params.get('right') || '';
  setTimeout(load, 50);
} else {
  try {
    const ll = sessionStorage.getItem('vidmark.compare.left');
    const rr = sessionStorage.getItem('vidmark.compare.right');
    if (ll) document.getElementById('leftUrl').value = ll;
    if (rr) document.getElementById('rightUrl').value = rr;
  } catch (_) {}
}
