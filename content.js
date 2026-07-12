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
  if (msg.type === 'sendInvite') {
    sendConnectionInvite(msg)
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

  // 4. Type the text with human-like rhythm; fall back to direct insertion.
  editor.focus();
  let inserted = await typeLikeHuman(editor, text);
  if (!inserted) inserted = insertText(editor, text);
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
  await sleep(700 + Math.random() * 1200); // brief pause, like re-reading it
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

// Type character by character with jittered delays and occasional short
// pauses, so the input pattern looks like a person rather than a paste.
// Pace is scaled so even long messages finish within ~18 seconds.
async function typeLikeHuman(editor, text) {
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  } catch (_) { /* empty composer is fine */ }
  const perCharMs = Math.min(110, Math.max(25, 18000 / Math.max(1, text.length)));
  for (const ch of text) {
    let ok;
    try {
      ok = document.execCommand('insertText', false, ch);
    } catch (_) {
      ok = false;
    }
    if (!ok) return false;
    await sleep(perCharMs * (0.5 + Math.random()));
    if (Math.random() < 0.03) await sleep(250 + Math.random() * 450);
  }
  return editor.textContent.includes(text.slice(0, 20));
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
// Sending a connection request from a search / "People you may know" page
// ---------------------------------------------------------------------------

async function sendConnectionInvite({ note, skipIds = [], filter = null }) {
  const skip = new Set(skipIds);

  // Find the first actionable Connect button whose person matches the target
  // filter, waiting a little in case results render late.
  let pick = pickConnectButton(skip, filter);
  if (!pick.button) {
    await waitFor(() => {
      pick = pickConnectButton(skip, filter);
      return pick.button;
    }, 12000);
  }
  if (!pick.button) {
    return { none: true, filteredOut: pick.filteredOut };
  }
  const btn = pick.button;

  const name = connectButtonName(btn);
  const firstName = (name || '').split(' ')[0] || 'there';
  const id = profileIdNear(btn);
  const headline = cardHeadline(cardOf(btn), name);
  if (id && skip.has(id)) return { none: true, filteredOut: pick.filteredOut };

  btn.scrollIntoView({ block: 'center' });
  await sleep(500 + Math.random() * 800);
  btn.click();

  // A confirmation dialog usually appears. If it doesn't within ~2.5s, the
  // invite was sent directly.
  const dialog = await waitFor(
    () => document.querySelector('div[role="dialog"]'),
    2500
  );
  if (!dialog) {
    return confirmInviteSent(btn, id, name, headline);
  }

  const wantNote = note && note.trim();
  if (wantNote) {
    const addNoteBtn = findDialogButton(dialog, ['add a note']);
    if (addNoteBtn) {
      addNoteBtn.click();
      const textarea = await waitFor(
        () => dialog.querySelector('textarea'),
        4000
      );
      if (textarea) {
        const text = note
          .replaceAll('{firstName}', firstName)
          .replaceAll('{fullName}', name || '')
          .replace(/\{([^{}]*\|[^{}]*)\}/g, (_, g) => {
            const o = g.split('|');
            return o[Math.floor(Math.random() * o.length)];
          });
        textarea.focus();
        setNativeValue(textarea, text);
        await sleep(400 + Math.random() * 600);
        const sendNote = findDialogButton(dialog, ['send invitation', 'send now', 'send']);
        if (sendNote) {
          sendNote.click();
          return confirmInviteSent(btn, id, name, headline);
        }
      }
      // Note path failed (e.g. free-account note limit) — fall through and
      // send without a note instead of leaving the dialog stuck.
    }
  }

  const sendPlain = findDialogButton(dialog, [
    'send without a note', 'send without note', 'send invitation', 'send now', 'send'
  ]);
  if (sendPlain) {
    sendPlain.click();
    return confirmInviteSent(btn, id, name, headline);
  }

  // Couldn't find a send control — bail cleanly.
  dismissDialog(dialog);
  return { error: 'Connect dialog opened but no Send button was found.' };
}

// Pick the first visible Connect button whose person isn't already invited
// and matches the target filter. Also reports how many candidates were
// skipped purely because they didn't match, so the caller can explain a
// "nobody to invite" result.
function pickConnectButton(skip, filter) {
  const buttons = [...document.querySelectorAll('button')];
  let filteredOut = 0;
  for (const b of buttons) {
    if (!visible(b)) continue;
    const label = (b.getAttribute('aria-label') || '').toLowerCase();
    const text = (b.textContent || '').trim().toLowerCase();
    const isConnect = /to connect$/.test(label) || text === 'connect';
    if (!isConnect) continue;
    if (b.disabled) continue;
    const id = profileIdNear(b);
    if (id && skip.has(id)) continue;
    if (filter && filter.enabled && !matchesTarget(b, filter)) {
      filteredOut++;
      continue;
    }
    return { button: b, filteredOut };
  }
  return { button: null, filteredOut };
}

// Decide whether a candidate's card matches the target roles/seniority.
// Matches on the whole card's visible text so it's resilient to markup
// changes (title, "Talent Acquisition at X", etc. all live in that text).
function matchesTarget(btn, filter) {
  const card = cardOf(btn);
  const hay = ((card && card.innerText) || '').toLowerCase();
  if (!hay) return false;
  if (filter.excludes && filter.excludes.some((k) => hay.includes(k))) return false;
  if (filter.targets && filter.targets.length) {
    return filter.targets.some((k) => hay.includes(k));
  }
  return true;
}

function cardOf(btn) {
  return (
    btn.closest('li') ||
    btn.closest('[data-view-name]') ||
    btn.closest('div.entity-result') ||
    btn.closest('div.discover-entity-type-card') ||
    btn.parentElement
  );
}

// Best-effort extraction of the person's headline/occupation for the log.
function cardHeadline(card, name) {
  if (!card) return '';
  const sel = card.querySelector(
    '.entity-result__primary-subtitle, .discover-person-card__occupation, ' +
    '.artdeco-entity-lockup__subtitle, .mn-connection-card__occupation, ' +
    '[class*="subtitle"], [class*="occupation"]'
  );
  if (sel && sel.textContent.trim()) return sel.textContent.trim();
  const skip = ['connect', 'message', 'follow', 'pending', 'ignore'];
  for (const line of card.innerText.split('\n').map((s) => s.trim()).filter(Boolean)) {
    const low = line.toLowerCase();
    if (name && line.includes(name)) continue;
    if (skip.includes(low)) continue;
    if (/mutual connection|followers?$|• \d/i.test(line)) continue;
    return line;
  }
  return '';
}

function connectButtonName(btn) {
  const label = btn.getAttribute('aria-label') || '';
  const m = label.match(/^Invite (.+?) to connect$/i);
  if (m) return m[1].trim();
  const id = profileIdNear(btn);
  return id ? id.replace(/-/g, ' ') : '';
}

function profileIdNear(btn) {
  const card =
    btn.closest('li') ||
    btn.closest('[data-view-name]') ||
    btn.closest('div.entity-result') ||
    btn.parentElement;
  const scope = card || document;
  const a = scope.querySelector && scope.querySelector('a[href*="/in/"]');
  return profileIdFromHref(a && a.href);
}

function findDialogButton(dialog, labelFragments) {
  const buttons = [...dialog.querySelectorAll('button')];
  for (const frag of labelFragments) {
    for (const b of buttons) {
      if (!visible(b)) continue;
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const text = (b.textContent || '').trim().toLowerCase();
      if (label.includes(frag) || text === frag || text.includes(frag)) return b;
    }
  }
  return null;
}

async function confirmInviteSent(btn, id, name, headline) {
  // Success shows a "Pending" state or a toast; either way give it a moment.
  await sleep(1200);
  dismissDialog(document.querySelector('div[role="dialog"]'));
  return { sent: true, id, name, headline };
}

function dismissDialog(dialog) {
  if (!dialog) return;
  const close = dialog.querySelector(
    'button[aria-label^="Dismiss"], button[aria-label^="Close"]'
  );
  if (close) close.click();
}

// React-controlled inputs need their value set through the native setter and
// an input event, or the framework ignores the change.
function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value');
  if (setter && setter.set) setter.set.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
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
