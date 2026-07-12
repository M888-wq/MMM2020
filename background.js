// LinkedIn Networker — background service worker.
// Owns all state (chrome.storage.local), scheduling (chrome.alarms), and
// tab orchestration. The content script only acts when this worker asks.

const CONNECTIONS_URL =
  'https://www.linkedin.com/mynetwork/invite-connect/connections/';

const DEFAULT_SETTINGS = {
  enabled: false,        // master switch — off until the user turns it on
  reviewMode: false,     // true = fill the composer but let the user hit Send
  dailyCap: 10,          // max outgoing messages per calendar day
  checkIntervalMin: 30,  // how often to scan for new connections
  minGapMin: 20,         // minimum wait between two outgoing messages
  gapJitterMin: 15,      // random extra wait added to the gap
  followUpsEnabled: true,
  stage2DelayDays: 3,    // days after stage 1 before the rapport message
  stage3DelayDays: 7     // days after stage 2 before the referral ask
};

const DEFAULT_TEMPLATES = {
  stage1:
    'Hi {firstName}, thanks for connecting! I came across your profile and ' +
    'really liked what you’re working on. Always glad to meet people in ' +
    'the field — hope your week is going well!',
  stage2:
    'Hi {firstName}, hope you’ve been well! I’d love to hear a bit ' +
    'about your experience in your current role — I’m always curious ' +
    'how different teams approach things. If you’re ever open to a quick ' +
    'chat, I’d really enjoy that.',
  stage3:
    'Hi {firstName}, I’ll be upfront — I’m currently exploring ' +
    'my next role, and your company genuinely caught my eye. If you think I ' +
    'could be a fit, would you be open to referring me or pointing me to the ' +
    'right person or opening? Happy to send over my resume and a short blurb ' +
    'to make it easy. Either way, I’m glad we connected!'
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getStore(keys) {
  return chrome.storage.local.get(keys);
}

async function setStore(obj) {
  return chrome.storage.local.set(obj);
}

async function getSettings() {
  const { settings } = await getStore('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

async function getTemplates() {
  const { templates } = await getStore('templates');
  return { ...DEFAULT_TEMPLATES, ...(templates || {}) };
}

async function log(message) {
  const { activityLog = [] } = await getStore('activityLog');
  activityLog.unshift({ ts: Date.now(), message });
  await setStore({ activityLog: activityLog.slice(0, 200) });
}

async function updateBadge() {
  const { contacts = {} } = await getStore('contacts');
  const pending = Object.values(contacts).filter((c) =>
    ['queued', 'following', 'review', 'replied'].includes(c.status)
  ).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#0a66c2' });
  await chrome.action.setBadgeText({ text: pending ? String(pending) : '' });
}

// ---------------------------------------------------------------------------
// Install / alarms
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const store = await getStore(['settings', 'templates']);
  if (!store.settings) await setStore({ settings: DEFAULT_SETTINGS });
  if (!store.templates) await setStore({ templates: DEFAULT_TEMPLATES });
  await resetAlarms();
  await log('Extension installed. Turn it on from the popup when ready.');
});

chrome.runtime.onStartup.addListener(resetAlarms);

async function resetAlarms() {
  const settings = await getSettings();
  await chrome.alarms.clear('scan');
  await chrome.alarms.clear('queue');
  chrome.alarms.create('scan', {
    periodInMinutes: Math.max(5, settings.checkIntervalMin),
    delayInMinutes: 1
  });
  chrome.alarms.create('queue', { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === 'scan') await runScan(false);
    if (alarm.name === 'queue') await processQueue();
  } catch (e) {
    await log(`Error in ${alarm.name}: ${e.message || e}`);
  }
});

// ---------------------------------------------------------------------------
// Messages from popup and content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case 'scanNow':
          await runScan(true);
          sendResponse({ ok: true });
          break;
        case 'scanResult': // passive scan from a connections tab the user has open
          await handleScanResult(msg.profiles || [], 'passive scan');
          sendResponse({ ok: true });
          break;
        case 'sendNow':
          await sendToContact(msg.id, { force: true });
          sendResponse({ ok: true });
          break;
        case 'setContactStatus':
          await setContactStatus(msg.id, msg.status);
          sendResponse({ ok: true });
          break;
        case 'advanceStage':
          await advanceStageManually(msg.id);
          sendResponse({ ok: true });
          break;
        case 'settingsChanged':
          await resetAlarms();
          sendResponse({ ok: true });
          break;
        default:
          sendResponse({ ok: false, error: 'unknown message' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e.message || e) });
    }
  })();
  return true; // async response
});

// ---------------------------------------------------------------------------
// Scanning for new connections
// ---------------------------------------------------------------------------

async function runScan(manual) {
  const settings = await getSettings();
  if (!settings.enabled && !manual) return;

  // Reuse a tab already showing the connections page, otherwise open a
  // background tab, scrape it, and close it again.
  const existing = await chrome.tabs.query({
    url: 'https://www.linkedin.com/mynetwork/invite-connect/connections/*'
  });

  let tabId;
  let openedByUs = false;
  if (existing.length) {
    tabId = existing[0].id;
  } else {
    const tab = await chrome.tabs.create({ url: CONNECTIONS_URL, active: false });
    tabId = tab.id;
    openedByUs = true;
    await waitForTabComplete(tabId, 30000);
    await sleep(4000); // let the SPA render the list
  }

  try {
    const result = await sendToTab(tabId, { type: 'scan' });
    if (result && result.profiles) {
      await handleScanResult(result.profiles, manual ? 'manual scan' : 'scheduled scan');
    } else {
      await log(`Scan failed: ${result && result.error ? result.error : 'no response'}. ` +
        'Make sure you are logged into LinkedIn in this browser.');
    }
  } finally {
    if (openedByUs) {
      try { await chrome.tabs.remove(tabId); } catch (_) { /* already closed */ }
    }
  }
}

async function handleScanResult(profiles, source) {
  if (!profiles.length) {
    await log(`Scan (${source}) found no connections — page layout may have ` +
      'changed or you may be logged out.');
    return;
  }

  const { known = null, contacts = {} } = await getStore(['known', 'contacts']);

  // First ever scan: record a baseline so we never message pre-existing
  // connections, only ones accepted from now on.
  if (!known) {
    const baseline = {};
    for (const p of profiles) baseline[p.id] = true;
    await setStore({ known: baseline });
    await log(`Baseline set: ${profiles.length} existing connections recorded. ` +
      'New connections accepted from now on will enter the pipeline.');
    return;
  }

  const fresh = profiles.filter((p) => !known[p.id] && !contacts[p.id]);
  if (!fresh.length) return;

  const now = Date.now();
  for (const p of fresh) {
    known[p.id] = true;
    contacts[p.id] = {
      id: p.id,
      name: p.name,
      firstName: p.firstName || (p.name || '').split(' ')[0],
      headline: p.headline || '',
      url: p.url,
      detectedAt: now,
      stage: 0,            // 0 = nothing sent yet
      status: 'queued',    // queued | following | review | replied | paused | done | error
      retries: 0,
      nextDueAt: now,      // eligible immediately; global pacing still applies
      lastMessageAt: null
    };
    await log(`New connection detected: ${p.name}`);
  }
  await setStore({ known, contacts });
  await updateBadge();
}

// ---------------------------------------------------------------------------
// Outgoing message queue
// ---------------------------------------------------------------------------

async function processQueue() {
  const settings = await getSettings();
  if (!settings.enabled) return;

  const now = Date.now();
  const store = await getStore(['contacts', 'counters', 'nextSendAllowedAt']);
  const contacts = store.contacts || {};

  // Reset the daily counter at local midnight.
  const today = new Date().toDateString();
  let counters = store.counters || { date: today, sent: 0 };
  if (counters.date !== today) counters = { date: today, sent: 0 };

  if (counters.sent >= settings.dailyCap) return;
  if (store.nextSendAllowedAt && now < store.nextSendAllowedAt) return;

  const due = Object.values(contacts)
    .filter((c) => ['queued', 'following'].includes(c.status) && c.nextDueAt <= now)
    .sort((a, b) => a.nextDueAt - b.nextDueAt);
  if (!due.length) return;

  await setStore({ counters });
  await sendToContact(due[0].id, { force: false });
}

async function sendToContact(id, { force }) {
  const settings = await getSettings();
  const templates = await getTemplates();
  const { contacts = {}, counters } = await getStore(['contacts', 'counters']);
  const contact = contacts[id];
  if (!contact) throw new Error('Unknown contact');

  const stage = contact.stage + 1; // stage we are about to send (1..3)
  if (stage > 3) return;

  const template = templates[`stage${stage}`] || '';
  const text = fillTemplate(template, contact);
  if (!text.trim()) {
    await log(`No template for stage ${stage}; skipping ${contact.name}.`);
    return;
  }

  const review = settings.reviewMode;
  const tab = await chrome.tabs.create({ url: contact.url, active: review });
  let result;
  try {
    await waitForTabComplete(tab.id, 30000);
    await sleep(4000);
    result = await sendToTab(tab.id, {
      type: 'sendMessage',
      text,
      review,
      checkReply: stage > 1 // don't send a canned follow-up over their reply
    });
  } catch (e) {
    result = { error: String(e.message || e) };
  }

  const now = Date.now();
  if (result && result.replied) {
    contact.status = 'replied';
    await log(`${contact.name} has replied — automation paused for them. ` +
      'Continue the conversation yourself, it lands better.');
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
  } else if (result && result.sent) {
    contact.stage = stage;
    contact.lastMessageAt = now;
    contact.retries = 0;
    if (stage === 1 && settings.followUpsEnabled) {
      contact.status = 'following';
      contact.nextDueAt = now + settings.stage2DelayDays * 86400000;
    } else if (stage === 2 && settings.followUpsEnabled) {
      contact.status = 'following';
      contact.nextDueAt = now + settings.stage3DelayDays * 86400000;
    } else {
      contact.status = 'done';
    }
    const c = counters && counters.date === new Date().toDateString()
      ? counters : { date: new Date().toDateString(), sent: 0 };
    c.sent += 1;
    const gapMs = (settings.minGapMin + Math.random() * settings.gapJitterMin) * 60000;
    await setStore({ counters: c, nextSendAllowedAt: now + gapMs });
    await log(`Stage ${stage} message sent to ${contact.name}.`);
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
  } else if (result && result.review) {
    contact.status = 'review';
    await log(`Composer prepared for ${contact.name} (stage ${stage}) — ` +
      'review the tab and hit Send, then mark it sent in the popup.');
    // Leave the tab open for the user.
  } else {
    contact.retries = (contact.retries || 0) + 1;
    if (contact.retries >= 3 && !force) {
      contact.status = 'error';
      await log(`Giving up on ${contact.name} after 3 attempts: ` +
        `${(result && result.error) || 'unknown error'}. Send manually or retry from the popup.`);
    } else {
      contact.nextDueAt = now + 30 * 60000;
      await log(`Could not message ${contact.name}: ` +
        `${(result && result.error) || 'unknown error'}. Will retry.`);
    }
    try { await chrome.tabs.remove(tab.id); } catch (_) {}
  }

  contacts[id] = contact;
  await setStore({ contacts });
  await updateBadge();
}

async function setContactStatus(id, status) {
  const { contacts = {} } = await getStore('contacts');
  if (!contacts[id]) return;
  contacts[id].status = status;
  if (['queued', 'following'].includes(status)) {
    contacts[id].retries = 0;
    contacts[id].nextDueAt = Date.now();
  }
  await setStore({ contacts });
  await updateBadge();
}

// After the user sends a reviewed draft themselves, advance the pipeline.
async function advanceStageManually(id) {
  const settings = await getSettings();
  const { contacts = {} } = await getStore('contacts');
  const contact = contacts[id];
  if (!contact) return;
  contact.stage = Math.min(3, contact.stage + 1);
  contact.lastMessageAt = Date.now();
  if (contact.stage >= 3 || !settings.followUpsEnabled) {
    contact.status = 'done';
  } else {
    contact.status = 'following';
    const delayDays = contact.stage === 1 ? settings.stage2DelayDays : settings.stage3DelayDays;
    contact.nextDueAt = Date.now() + delayDays * 86400000;
  }
  await setStore({ contacts });
  await updateBadge();
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fillTemplate(template, contact) {
  return template
    .replaceAll('{firstName}', contact.firstName || 'there')
    .replaceAll('{fullName}', contact.name || '')
    .replaceAll('{headline}', contact.headline || '');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // proceed anyway; the retry loop in sendToTab copes
    }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(reject);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Message a tab's content script, retrying while the script boots.
async function sendToTab(tabId, message, attempts = 8) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (e) {
      if (i === attempts - 1) throw e;
      await sleep(1500);
    }
  }
}
