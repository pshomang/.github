# AMEN — Workplace Word

A daily-devotional app for young African professionals: contextual scripture for the Monday–Saturday grind, plus ready-made discussion sparks their small group can run on WhatsApp.

## Core Problem

Young African professionals deal with heavy "black tax," high-pressure careers, and long commutes. Small-group leaders struggle to keep people engaged between Sundays. The gap isn't a lack of Bible content — it's a lack of *contextual, immediate application* of scripture during the week.

## V1 Scope

V1 ships as a dependency-free, single-file React app (`index.html`, React + Babel + Tailwind via CDN) that runs entirely client-side with `localStorage` as its database — no backend, no build step, 100% offline-capable after the first load. It is the direct porting target for a React Native (Expo) build with a web fallback, which is the intended production stack for reach across iOS/Android/mobile-web with one codebase.

Running it locally:

```bash
cd amen-app
python3 -m http.server 8080
# then open http://localhost:8080
```

Or just double-click `index.html` — it has no external data fetches, so it also works from a `file://` URL.

### The five features that made the cut

1. **Situational Filter** — Home screen shows a grid of real work situations ("Anxiety," "Leadership," "Conflict," "Provision," "Burnout," "Foundation") instead of generic "inspiration." Tapping one surfaces a matching verse.
2. **WhatsApp "Spark" Generator** — One tap formats the verse, its modern application, and a discussion question into a `wa.me` share link, ready to drop into a small-group chat.
3. **First-Fruits Tracker** — A simple streak counter (`localStorage`) that gamifies opening the app before the day's distractions take over.
4. **Contextual "Then vs. Now" Toggle** — Every verse carries two written payloads: the historical/biblical context and a modern, workplace-specific application, toggled on the verse screen.
5. **Corporate Calling Track** — The seed data leans heavily on workplace situations (integrity, leadership, provision) so the content itself validates professional ambition inside a biblical frame.

These five were chosen over 7 other candidates (Commute Audio, Sermon Notes Sync, Accountability Nudge, Deep Dive Interlinear, Prayer Board, Vernacular Toggle, Lock-Screen Memory) by scoring each on daily-return value, audience fit, build effort, and differentiation — the ones cut all required a backend, a large content/translation investment, or third-party APIs that don't belong in a zero-budget V1.

### Data model

```json
// Verses (hardcoded in V1)
{
  "id": 8,
  "category": "Leadership",
  "ref": "Proverbs 16:3",
  "text": "Commit your works to the Lord, And your thoughts will be established.",
  "historical": "A proverb emphasizing total reliance on Yahweh.",
  "modern": "Before you send that proposal, hand the outcome over to God.",
  "question": "What specific task today are you holding onto too tightly?"
}

// UserState (localStorage keys)
amen_streak      // number of days opened
amen_lastOpened  // last date string the app was opened
```

### Navigation flow

1. **Home** — shows the First-Fruits streak and the situational-filter grid.
2. **Verse** — shows the NKJV text, the Historical/Modern toggle, the discussion question, and the WhatsApp share button.

### Content licensing

The seed data uses 30 NKJV verses. Thomas Nelson's fair-use policy permits quoting up to 250 verses without a license, provided they don't constitute a complete book or 25% of a work — 30 verses is well inside that limit. If the verse bank grows past 250, either request an NKJV API license or switch to the World English Bible (WEB), which is public domain.

## Post-Launch Backlog (ranked)

Once V1 is live and habits are forming, build these next without bloating the app:

1. **Vernacular Toggle** — local-language translations (e.g. Setswana, Zulu) for heart-level resonance beyond English business-speak.
2. **Accountability Nudge** — auto-notify a small-group partner when a First-Fruits streak breaks.
3. **Commute Audio** — text-to-speech playback of the verse and application for users in traffic/transit.
4. **Lock-Screen Memory** — export a verse + modern application as a wallpaper via canvas.
5. **Prayer Board** — requires a backend (Supabase/Firebase); anonymous, industry-specific prayer feeds.
6. **Sermon Notes Sync** — regex-linked scripture references inside a notes editor; highest effort, but ties Sunday service directly into weekday app use.

## Porting to Expo

The logic in `index.html` (seed data, category filtering, streak tracking, WhatsApp share URL) is written to translate directly to React Native + Expo:

- `localStorage` → `AsyncStorage` (or `expo-secure-store` if it ever holds anything sensitive).
- `window.open(wa.me/...)` → `Linking.openURL(...)`.
- Tailwind utility classes → `StyleSheet` or a Tailwind-for-RN library (e.g. `nativewind`), keeping the same visual system.
- The two view states (`home` / `verse`) map to two screens in React Navigation.
