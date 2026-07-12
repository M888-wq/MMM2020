# LinkedIn Networker

A Chrome extension that helps turn newly accepted LinkedIn connections into
real relationships — and, when the time is right, a referral. It runs in your
own logged-in browser session (no API keys, no third-party servers, all data
stays in local extension storage).

## What it does

1. **Watches your connections list.** On a schedule (default: every 30
   minutes) it opens your connections page in a background tab, reads the
   most recent connections, and closes the tab. If you already have the
   connections page open, it reads that instead.
2. **Sets a baseline on first run** so your *existing* connections are never
   messaged — only people who accept a request after you turn it on.
3. **Sends a staged message sequence** to each new connection:
   - **Stage 1 — friendly intro**, sent shortly after they accept. No ask.
   - **Stage 2 — build rapport**, sent 24 hours later (configurable in hours).
   - **Stage 3 — the referral ask**, sent 48 hours after that (configurable).
4. **Stops the moment they reply.** Before sending a follow-up it checks the
   conversation; if the person has written back, automation for that contact
   pauses and the popup flags them so *you* take over. A real conversation
   always beats a canned sequence — especially when you're asking for a
   referral.

Every message, delay, and threshold is editable from the popup.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Make sure you're logged into LinkedIn in the same browser.
6. Click the extension icon and flip the toggle on. The first scan records
   your baseline; you'll see it in the activity log.

## Using it

- **Pipeline** shows every contact being worked: their stage, status, and
  when the next message is due. Per-contact controls: *Send next now*,
  *Pause*, *Resume*, *Done*.
- **Templates** support `{firstName}`, `{fullName}`, and `{headline}`
  placeholders, plus `{option A|option B}` variation groups — one option is
  picked at random per message so no two contacts receive identical text.
  Rewrite them in your own voice — defaults are just a starting point, and
  personal messages convert far better.
- **Review mode** (Settings) drafts each message in the composer and leaves
  the tab open for you to read and hit Send yourself. Click **"I sent it"**
  in the popup afterwards to advance the contact's stage. Recommended for
  stage 3 — a referral ask is worth 20 seconds of your attention.
- **Safety pacing**: a daily cap (default 5), a randomized gap between
  messages (default 20–35 min), and scheduled scans keep volume low.
- **Humanized sending**: messages are typed into the composer character by
  character with jittered delays and occasional pauses (instead of being
  pasted instantly), there's a short "re-read" pause before Send is clicked,
  and template variations keep the wording from being identical across
  contacts.

## Important caveats

- **LinkedIn's Terms of Service prohibit automation.** Heavy or bot-like
  activity can get an account restricted or banned. This tool is built for
  low-volume personal networking — the default cap is 5 messages/day, and
  keeping it at or below that is strongly recommended. Keep the templates
  human and prefer review mode when in doubt. Use at your own risk.
- **The DOM changes.** LinkedIn updates its markup regularly. The scraper and
  composer logic in `content.js` use several fallback strategies, but if
  scans start reporting "no connections found" or sends fail, the selectors
  there are the first place to look.
- **English UI assumed.** The profile "Message" button is located by its
  `aria-label`, which is language-dependent. If your LinkedIn is set to
  another language, update `findMessageButton()` in `content.js`.
- **Referrals come from relationships, not scripts.** The sequence gets the
  conversation started; landing the referral usually happens in the replies,
  which are intentionally left to you.

## Layout

```
manifest.json      MV3 manifest
background.js      Service worker: scheduling, pipeline state, tab orchestration
content.js         Runs on linkedin.com: scans connections, drafts/sends messages
popup/             Popup UI: pipeline, templates, settings, activity log
icons/             Extension icons
```

All state lives in `chrome.storage.local`: `settings`, `templates`, `known`
(the baseline set), `contacts` (the pipeline), `counters` (daily send count),
and `activityLog`.
