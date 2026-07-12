// LinkedIn Networker — content script.
// Runs on linkedin.com pages but only acts when the background worker asks
// (scan the connections list, or fill/send a message on a profile page).
// It also passively reports the connections list when the user happens to
// be browsing it, so new connections are picked up without extra tabs.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'ping') {
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'scan') {
    scanConnections()
      .then((profiles) => sendResponse({ profiles }))
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
  if (msg.type === 'sendMessage') {
    sendLinkedInMessage(msg)
      .then(sendResponse)
      .catch((e) => sendResponse({ error: String(e.message || e) }));
    return true;
  }
});

// ---------------------------------------------------------------------------
// Connections page scraping
// ---------------------------------------------------------------------------

function onConnectionsPage() {
  return location.pathname.startsWith('/mynetwork/invite-connect/connections');
}

async function scanConnections() {
  if (!onConnectionsPage()) {
    throw new Error('Not on the connections page');
  }
  // The list renders sorted by "Recently added" by default, so the first
  // page of results is enough to diff against the known set.
  const profiles = await waitFor(() => {
    const found = collectConnectionCards();
    return found.length ? found : null;
  }, 15000);
  return profiles || [];
}

function collectConnectionCards() {
  // Strategy 1: the long-standing connections-list markup.
  const classic = [...document.querySelectorAll('li.mn-connection-card')];
  if (classic.length) {
    return classic.map((li) => {
      const a = li.querySelector('a[href*="/in/"]');
      const id = profileIdFromHref(a && a.href);
      if (!id) return null;
      const name = textOf(li.querySelector('.mn-connection-card__name')) ||
        imgAlt(li) || '';
      return {
        id,
        url: `https://www.linkedin.com/in/${encodeURIComponent(id)}/`,
        name,
        firstName: name.split(' ')[0] || '',
        headline: textOf(li.querySelector('.mn-connection-card__occupation'))
      };
    }).filter(Boolean);
  }

  // Strategy 2 (newer layouts): any list rows in <main> that contain a
  // profile link. Name comes from the avatar's alt text or the link text.
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('main a[href*="/in/"]')) {
    const id = profileIdFromHref(a.href);
    if (!id || seen.has(id)) continue;
    const row = a.closest('li') || a.closest('[data-view-name]');
    if (!row) continue;
    seen.add(id);
    const name = imgAlt(row) || firstTextLine(a) || firstTextLine(row);
    if (!name) continue;
    out.push({
      id,
      url: `https://www.linkedin.com/in/${encodeURIComponent(id)}/`,
      name,
      firstName: name.split(' ')[0] || '',
      headline: ''
    });
  }
  return out;
}

function profileIdFromHref(href) {
  if (!href) return null;
  const m = href.match(/linkedin\.com\/in\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function imgAlt(el) {
  const img = el.querySelector('img[alt]');
  const alt = img && img.alt.trim();
  // Avatar alt text is usually the bare name; ignore decorative alts.
  return alt && alt.length > 1 && alt.length < 80 ? alt : '';
}

function textOf(el) {
  return el ? el.textContent.trim() : '';
}

function firstTextLine(el) {
  const t = el.textContent.trim().split('\n').map((s) => s.trim()).filter(Boolean);
  return t[0] || '';
}

// Passive reporting: if the user is browsing their connections list anyway,
// hand the visible list to the background worker (throttled to once/5 min).
if (onConnectionsPage()) {
  setTimeout(async () => {
    try {
      const last = Number(sessionStorage.getItem('lnw-last-passive') || 0);
      if (Date.now() - last < 5 * 60000) return;
      const profiles = await scanConnections();
      if (profiles.length) {
        sessionStorage.setItem('lnw-last-passive', String(Date.now()));
        chrome.runtime.sendMessage({ type: 'scanResult', profiles });
      }
    } catch (_) { /* page not ready — the scheduled scan will get it */ }
  }, 5000);
}

// ---------------------------------------------------------------------------
// Messaging from a profile page
// ---------------------------------------------------------------------------

async function sendLinkedInMessage({ text, review, checkReply }) {
  // 1. Find and click the profile's Message button (English UI assumed).
  const button = await waitFor(() => findMessageButton(), 12000);
  if (!button) {
    return { error: 'Message button not found on profile (page layout may have changed, or messaging this person requires InMail).' };
  }
  button.click();

  // 2. Wait for the message composer overlay.
  const editor = await waitFor(
    () => visible(document.querySelector('.msg-form__contenteditable')),
    12000
  );
  if (!editor) {
    return { error: 'Message composer did not open.' };
  }
  await sleep(1200); // let the thread history load

  // 3. For follow-ups, bail out if the person has already written back —
  //    a canned message on top of their reply would hurt the relationship.
  if (checkReply && threadHasIncomingMessage()) {
    closeComposer();
    return { replied: true };
  }

  // 4. Insert the text.
  editor.focus();
  const inserted = insertText(editor, text);
  if (!inserted) {
    return { error: 'Could not insert message text into the composer.' };
  }

  // 5. Review mode: leave the drafted message for the user to send.
  if (review) {
    return { ok: true, review: true };
  }

  // 6. Send it and confirm the composer cleared.
  const sendBtn = await waitFor(() => {
    const b = document.querySelector('.msg-form__send-button');
    return b && !b.disabled ? b : null;
  }, 8000);
  if (!sendBtn) {
    return { error: 'Send button never became enabled.' };
  }
  sendBtn.click();

  const cleared = await waitFor(
    () => (editor.textContent.trim() === '' ? true : null),
    8000
  );
  if (!cleared) {
    return { error: 'Clicked send but the composer did not clear — message may not have gone out.' };
  }
  await sleep(800);
  closeComposer();
  return { ok: true, sent: true };
}

function findMessageButton() {
  const scopes = [
    document.querySelector('main .pv-top-card') || document.querySelector('main'),
    document
  ];
  for (const scope of scopes) {
    if (!scope) continue;
    const candidates = scope.querySelectorAll(
      'button[aria-label^="Message"], a[aria-label^="Message"]'
    );
    for (const c of candidates) {
      if (visible(c)) return c;
    }
  }
  return null;
}

function threadHasIncomingMessage() {
  // Incoming bubbles carry the --other modifier in the message overlay.
  if (document.querySelector('.msg-s-event-listitem--other')) return true;
  return false;
}

function insertText(editor, text) {
  try {
    document.execCommand('selectAll', false, null);
    if (document.execCommand('insertText', false, text) &&
        editor.textContent.includes(text.slice(0, 20))) {
      return true;
    }
  } catch (_) { /* fall through to manual insertion */ }
  const p = document.createElement('p');
  p.textContent = text;
  editor.innerHTML = '';
  editor.appendChild(p);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  return editor.textContent.includes(text.slice(0, 20));
}

function closeComposer() {
  const bubble = document.querySelector('.msg-overlay-conversation-bubble');
  if (!bubble) return;
  const close = bubble.querySelector(
    'button[data-test-icon="close-small"], button[aria-label^="Close"]'
  );
  if (close) close.click();
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function visible(el) {
  return el && el.offsetParent !== null ? el : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs, everyMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const v = fn();
      if (v) return v;
    } catch (_) { /* keep polling */ }
    await sleep(everyMs);
  }
  return null;
}
