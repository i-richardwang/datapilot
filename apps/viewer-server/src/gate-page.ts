/**
 * HTML password gate served in front of `/s/h/{id}` when the share is
 * password-protected. The page submits the entered password via the
 * `x-share-password` header, fetches the real HTML, and replaces the
 * current document so the URL stays the same.
 *
 * Kept dependency-free (no framework, no external assets) so it loads
 * even when the protected HTML is the only thing the viewer serves.
 *
 * The user-facing strings are pulled from `webui.passwordPrompt.*` in the
 * shared locale registry via {@link GateStrings}; see `./gate-locale.ts`
 * for the `Accept-Language` resolution.
 */

import type { GateStrings } from './gate-locale'

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]!)
}

/**
 * @param url Path this gate protects (e.g. `/s/h/abc`). The gate fetches this
 *            URL with the password header to retrieve the real payload.
 * @param mode 'html' replaces the document with the fetched body; 'download'
 *             streams the returned bytes to a blob URL and navigates there
 *             (used for raw asset routes).
 * @param strings Localized `webui.passwordPrompt.*` strings. Callers resolve
 *                the locale from `Accept-Language` — see `./gate-locale.ts`.
 */
export function renderPasswordGate(
  url: string,
  mode: 'html' | 'download',
  strings: GateStrings,
): string {
  const safeUrl = JSON.stringify(url)
  const isHtml = mode === 'html'
  // Embed the error strings the client script needs as a JSON literal so we
  // don't have to interpolate each occurrence separately (and JSON.stringify
  // handles any quote / unicode escaping for us).
  const clientStrings = JSON.stringify({
    invalid: strings.invalid,
    loadFailedTemplate: strings.loadFailedTemplate,
    networkError: strings.networkError,
  })
  return `<!doctype html>
<html lang="${escapeHtml(strings.locale)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(strings.title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f5f5f4;
    --fg: #1c1917;
    --border: rgba(0,0,0,0.15);
    --muted: #57534e;
    --input-bg: #ffffff;
    --accent: #1c1917;
    --accent-fg: #ffffff;
    --error: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0c0a09;
      --fg: #fafaf9;
      --border: rgba(255,255,255,0.15);
      --muted: #a8a29e;
      --input-bg: #1c1917;
      --accent: #fafaf9;
      --accent-fg: #0c0a09;
      --error: #fca5a5;
    }
  }
  html, body { height: 100%; margin: 0; }
  body {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 16px;
  }
  .card {
    width: 100%;
    max-width: 360px;
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px 20px 16px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }
  h1 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
  p  { margin: 0 0 16px; color: var(--muted); font-size: 13px; }
  form { display: flex; flex-direction: column; gap: 12px; }
  input[type="password"] {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--fg);
    font: inherit;
    outline: none;
  }
  input[type="password"]:focus { border-color: var(--fg); }
  button {
    appearance: none;
    border: 0;
    padding: 8px 14px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-fg);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
  }
  button[disabled] { opacity: 0.6; cursor: not-allowed; }
  .error { color: var(--error); font-size: 12px; min-height: 16px; }
</style>
</head>
<body>
<div class="card">
  <h1>${escapeHtml(strings.title)}</h1>
  <p>${escapeHtml(strings.description)}</p>
  <form id="f">
    <input id="pw" type="password" autocomplete="current-password" autofocus required />
    <div class="error" id="err"></div>
    <button id="submit" type="submit">${escapeHtml(strings.submit)}</button>
  </form>
</div>
<script>
(function(){
  var url = ${safeUrl};
  var messages = ${clientStrings};
  var key = 'viewer-share-pw:' + url;
  var pwEl = document.getElementById('pw');
  var errEl = document.getElementById('err');
  var btn = document.getElementById('submit');
  var form = document.getElementById('f');

  function setError(text) { errEl.textContent = text || ''; }

  function writeHtml(text) {
    document.open();
    document.write(text);
    document.close();
  }

  function writeBlob(blob, mime) {
    // For direct asset downloads we don't have a richer UI — navigate the tab
    // to a blob URL that serves the bytes with the stored mime type.
    var obj = URL.createObjectURL(new Blob([blob], { type: mime }));
    window.location.replace(obj);
  }

  async function unlock(password) {
    var res = await fetch(url, { headers: { 'x-share-password': password } });
    if (res.status === 401) { setError(messages.invalid); return false; }
    if (!res.ok) { setError(messages.loadFailedTemplate.replace('{{status}}', String(res.status))); return false; }
    try { sessionStorage.setItem(key, password); } catch (_) {}
    ${isHtml
      ? `var text = await res.text(); writeHtml(text);`
      : `var mime = res.headers.get('content-type') || 'application/octet-stream'; var buf = await res.arrayBuffer(); writeBlob(buf, mime);`}
    return true;
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    setError('');
    btn.disabled = true;
    try {
      await unlock(pwEl.value);
    } catch (err) {
      setError(messages.networkError);
    } finally {
      btn.disabled = false;
    }
  });

  // Try a remembered password first so reloads in the same tab don't re-prompt.
  try {
    var saved = sessionStorage.getItem(key);
    if (saved) {
      unlock(saved).then(function(ok) {
        if (!ok) { try { sessionStorage.removeItem(key); } catch (_) {} pwEl.focus(); }
      });
    }
  } catch (_) {}
})();
</script>
</body>
</html>
`
}
