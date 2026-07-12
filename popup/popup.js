// LinkedIn Networker — popup UI. Reads state straight from storage and
// delegates actions to the background worker.

const STAGE_LABELS = ['New', 'Intro sent', 'Follow-up sent', 'Referral asked'];
const STATUS_LABELS = {
  queued: 'Queued',
  following: 'Following up',
  review: 'Awaiting your review',
  replied: 'They replied 🎉',
  paused: 'Paused',
  done: 'Sequence complete',
  error: 'Needs attention'
};

const $ = (id) => document.getElementById(id);

async function load() {
  const store = await chrome.storage.local.get([
    'settings', 'templates', 'contacts', 'counters', 'activityLog', 'known',
    'inviteCounters', 'inviteWeek'
  ]);
  const s = store.settings || {};

  $('enabled').checked = !!s.enabled;
  $('reviewMode').checked = !!s.reviewMode;
  $('followUpsEnabled').checked = s.followUpsEnabled !== false;
  $('dailyCap').value = s.dailyCap ?? 5;
  $('checkIntervalMin').value = s.checkIntervalMin ?? 30;
  $('minGapMin').value = s.minGapMin ?? 20;
  $('stage2DelayHours').value = s.stage2DelayHours ?? 24;
  $('stage3DelayHours').value = s.stage3DelayHours ?? 48;
  $('d2').textContent = s.stage2DelayHours ?? 24;
  $('d3').textContent = s.stage3DelayHours ?? 48;

  $('invitesEnabled').checked = !!s.invitesEnabled;
  $('inviteSearchUrl').value = s.inviteSearchUrl || '';
  $('inviteNote').value = s.inviteNote || '';
  $('dailyInviteCap').value = s.dailyInviteCap ?? 15;
  $('weeklyInviteCap').value = s.weeklyInviteCap ?? 80;
  $('inviteGapMin').value = s.inviteGapMin ?? 8;

  const t = store.templates || {};
  $('tpl1').value = t.stage1 || '';
  $('tpl2').value = t.stage2 || '';
  $('tpl3').value = t.stage3 || '';

  const today = new Date().toDateString();
  const sent = store.counters && store.counters.date === today ? store.counters.sent : 0;
  $('sentToday').textContent = `Sent today: ${sent}/${s.dailyCap ?? 5}`;

  const invToday = store.inviteCounters && store.inviteCounters.date === today
    ? store.inviteCounters.sent : 0;
  const invWeek = store.inviteWeek ? store.inviteWeek.sent : 0;
  $('invitesToday').textContent = `Invites today: ${invToday}/${s.dailyInviteCap ?? 15}`;
  $('invitesWeek').textContent = `This week: ${invWeek}/${s.weeklyInviteCap ?? 80}`;

  const contacts = Object.values(store.contacts || {})
    .sort((a, b) => b.detectedAt - a.detectedAt);
  const active = contacts.filter((c) => !['done'].includes(c.status));
  $('pipelineCount').textContent = `In pipeline: ${active.length}`;
  $('baselineNote').classList.toggle('hidden', !!store.known);

  renderContacts(contacts);
  renderLog(store.activityLog || []);
}

function renderContacts(contacts) {
  const box = $('contacts');
  box.textContent = '';
  if (!contacts.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'No connections in the pipeline yet. New accepts will show up here.';
    box.appendChild(div);
    return;
  }
  for (const c of contacts.slice(0, 30)) {
    const card = document.createElement('div');
    card.className = 'contact';

    const top = document.createElement('div');
    top.className = 'top';
    const link = document.createElement('a');
    link.href = c.url;
    link.target = '_blank';
    link.textContent = c.name || c.id;
    const badge = document.createElement('span');
    badge.className = `badge ${c.status}`;
    badge.textContent = STATUS_LABELS[c.status] || c.status;
    top.append(link, badge);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const due = ['queued', 'following'].includes(c.status) && c.nextDueAt
      ? ` · next: ${new Date(c.nextDueAt).toLocaleString()}` : '';
    meta.textContent = `${STAGE_LABELS[c.stage] || ''}${due}`;

    const actions = document.createElement('div');
    actions.className = 'actions';
    if (['queued', 'following', 'error', 'paused'].includes(c.status) && c.stage < 3) {
      actions.appendChild(actionBtn('Send next now', () => bg({ type: 'sendNow', id: c.id })));
    }
    if (['queued', 'following'].includes(c.status)) {
      actions.appendChild(actionBtn('Pause', () => bg({ type: 'setContactStatus', id: c.id, status: 'paused' }), true));
    }
    if (['paused', 'error', 'replied'].includes(c.status) && c.stage < 3) {
      actions.appendChild(actionBtn('Resume', () => bg({ type: 'setContactStatus', id: c.id, status: c.stage ? 'following' : 'queued' }), true));
    }
    if (c.status === 'review') {
      actions.appendChild(actionBtn('I sent it', () => bg({ type: 'advanceStage', id: c.id })));
    }
    if (c.status !== 'done') {
      actions.appendChild(actionBtn('Done', () => bg({ type: 'setContactStatus', id: c.id, status: 'done' }), true));
    }

    card.append(top, meta, actions);
    box.appendChild(card);
  }
}

function actionBtn(label, onClick, ghost) {
  const b = document.createElement('button');
  b.textContent = label;
  if (ghost) b.className = 'ghost';
  b.addEventListener('click', async () => {
    b.disabled = true;
    await onClick();
    await load();
  });
  return b;
}

function renderLog(entries) {
  const box = $('log');
  box.textContent = '';
  if (!entries.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Nothing yet.';
    box.appendChild(div);
    return;
  }
  for (const e of entries.slice(0, 50)) {
    const line = document.createElement('div');
    line.className = 'logline';
    const ts = document.createElement('span');
    ts.className = 'ts';
    ts.textContent = new Date(e.ts).toLocaleString();
    line.appendChild(ts);
    line.appendChild(document.createTextNode(e.message));
    box.appendChild(line);
  }
}

function bg(message) {
  return chrome.runtime.sendMessage(message).catch(() => ({}));
}

async function saveSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  Object.assign(settings, {
    enabled: $('enabled').checked,
    reviewMode: $('reviewMode').checked,
    followUpsEnabled: $('followUpsEnabled').checked,
    dailyCap: clamp($('dailyCap').value, 1, 50, 5),
    checkIntervalMin: clamp($('checkIntervalMin').value, 5, 720, 30),
    minGapMin: clamp($('minGapMin').value, 1, 240, 20),
    stage2DelayHours: clamp($('stage2DelayHours').value, 1, 336, 24),
    stage3DelayHours: clamp($('stage3DelayHours').value, 1, 336, 48),
    invitesEnabled: $('invitesEnabled').checked,
    inviteSearchUrl: $('inviteSearchUrl').value.trim(),
    inviteNote: $('inviteNote').value,
    dailyInviteCap: clamp($('dailyInviteCap').value, 1, 50, 15),
    weeklyInviteCap: clamp($('weeklyInviteCap').value, 1, 200, 80),
    inviteGapMin: clamp($('inviteGapMin').value, 1, 240, 8)
  });
  delete settings.stage2DelayDays; // clear values from the old day-based schema
  delete settings.stage3DelayDays;
  await chrome.storage.local.set({ settings });
  await bg({ type: 'settingsChanged' });
  await load();
}

function clamp(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

$('enabled').addEventListener('change', async () => {
  await saveSettings();
  if ($('enabled').checked) {
    const { known } = await chrome.storage.local.get('known');
    if (!known) await bg({ type: 'scanNow' }); // set the baseline right away
  }
});
$('saveSettings').addEventListener('click', saveSettings);
$('saveTemplates').addEventListener('click', async () => {
  await chrome.storage.local.set({
    templates: {
      stage1: $('tpl1').value,
      stage2: $('tpl2').value,
      stage3: $('tpl3').value
    }
  });
  $('saveTemplates').textContent = 'Saved ✓';
  setTimeout(() => ($('saveTemplates').textContent = 'Save templates'), 1500);
});
$('scanNow').addEventListener('click', async () => {
  $('scanNow').disabled = true;
  $('scanNow').textContent = 'Scanning…';
  await bg({ type: 'scanNow' });
  $('scanNow').disabled = false;
  $('scanNow').textContent = 'Scan now';
  await load();
});
$('saveInvites').addEventListener('click', async () => {
  await saveSettings();
  $('saveInvites').textContent = 'Saved ✓';
  setTimeout(() => ($('saveInvites').textContent = 'Save'), 1500);
});
$('inviteNow').addEventListener('click', async () => {
  await saveSettings(); // persist the URL/note before firing
  $('inviteNow').disabled = true;
  $('inviteNow').textContent = 'Inviting…';
  await bg({ type: 'inviteNow' });
  $('inviteNow').disabled = false;
  $('inviteNow').textContent = 'Invite now';
  await load();
});

chrome.storage.onChanged.addListener(() => load());
load();
