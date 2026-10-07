> **Historical spec, not maintained.** Written 2026-10-05 in round 4 of the Fluentish build as the plan for maintenance as the default (goals, the week plan, the sustainable allowance) and the long-term Progress view (amended before the build by the round 4 plan review).
> Copied here and privacy-scrubbed on 2026-10-07: personal data, names, local paths and scores were removed or
> summarised. Where it disagrees with the code, the code and the living docs win: `docs/CONTRIBUTING-FEATURES.md` (the week, the allowance and the level gate), `docs/ARCHITECTURE.md` §3.2 (Progress log) and §5, `docs/SCHEMA.md`.
> What was actually built, and what changed: `docs/history/round4-lifelong-learning.md`.

# Round 4 · Maintenance as the default, and progress over years (themes 1 and 5)

Planner: learning-experience design, 2026-10-05. I read the brief, CLAUDE.md, docs/ARCHITECTURE.md, DESIGN.md, CONTRIBUTING-FEATURES.md and SCHEMA.md, the round 3 journey review and build notes, and the code behind Today (`domain/budget.js`, `allowance.js`, `today.js`, `standing.js`, `features/today/*`, `data/sync/backup.js`, `data/restore.js`). I ran the app locally with the round 3 synthetic "after the exam" persona (plus the synthetic explore and mistakes seeds), WebKit at 390 px. The prototypes were three static pages (Today, Progress, Goals) driven by a generated synthetic learner, with shots at 390 px and 1280 px, light and dark; they were kept outside the repo and are not preserved. I did not edit the repo, and the servers and sessions I started are stopped.

**Every number in the mock-ups and example strings below is generated sample data from the synthetic learner, not the owner's study data.**

## 0. Position

Fluentish was built around a countdown. From now on the default is a calm daily loop with no end date. An exam is one goal he can add, move or remove, like any other goal. The loop should feel like this:
- **Anki's honesty:** the due count is the hero, it is never hidden, and any cost is stated plainly ("10 new items add about 9 min of reviews over the next month").
- **Things' calm:** one ordered list for today and a short "This week" list under it. Nothing nags.
- **Apple Fitness's long view:** the measure is the week. A missed day costs nothing on its own.
- **Strava's log:** weeks, hours and what he did, kept for years, so he can look back.

There are no streaks, no flames and no "in a row" (that copy is removed). Milestones are dated facts taken from a log. They never trigger a celebration screen.

The live app after the exam (seen with the synthetic persona) already has the `maintenance` mode and the one allowance. Its problems:
- The hero shows a 28-day square strip, plus "N days in a row" when he has a run going.
- Feedback still lists uncorrected mock Schreiben tasks.
- Where you stand is still four mock-score bars with per-module phrase counts, above one "N of 5,872 known" line.
- Nothing is kept from day to day, so the app cannot draw how his knowledge changed over time. **This is the urgent part (§4): every day without a log is a day the charts can only estimate.**

## 1. The daily loop

### 1.1 Order of a day (any length)
1. **Reviews from every deck, in one interleaved round.** They always come first. If they don't fit in the day, the most urgent go first and Today says so. This is today's rule and it stays.
2. **New items**, most common first, at the goal's level (§2). The number is the allowance's Auto value with one new guard, a *sustainable rate*: the reviews FSRS forecasts for the next 14 days, divided by the planned minutes of those days, may not exceed 55 %. When the forecast hits that limit, new items shrink before the day does. The row says why: "6 new (fewer this week: reviews are high)". A number he chose himself still wins, as it does now.
3. **One practice slot, chosen by the kind of day** (§1.3): Read (theme 3), Write, Talk (theme 4), or on a normal day a rotation of script step, Word building, situations and clusters. The slot gets a third of the day after reviews.
4. **Fillers** under "If you have time". They never push out a row above them.

### 1.2 What a day holds, by length (no exam)
| Day | Reviews | New items | Slot | Fillers |
|---|---|---|---|---|
| 20 min | 10 to 12 min (all due if they fit) | 4 to 6 (≈ 5 min) | 3 to 5 min: situations or a script cue step | none |
| 45 min | 12 to 15 | 8 to 10 (≈ 8 min) | 12 to 15 min: Read, Write or Talk by the day's kind | Word building 5 new, situations |
| 60 min | 15 | 10 to 12 | 20 min: a full article, a correction plus its mistakes, or a 20-min talk | Word building, clusters, script |

The reviews column is a floor, not a cap: on a 20-minute day with 30 min of reviews due, the day is all reviews and Today says so. Under these numbers sits a rule of thumb: about 25 % of a long-run day goes to new items and about 40 % to production (write, talk, script). Production is what moves B1 to B2 for someone who already recognises B1.

### 1.3 The week (the rhythm he sets once)
The week plan (Profile › Goals and week, prototype `goals.html`) gives each weekday minutes and a kind:

| Kind | What Today plans | Default |
|---|---|---|
| Normal | reviews, new items, the rotation slot | Mon, Fri |
| Light | reviews only, no new items, about 20 min | Wed |
| Read | reviews, fewer new items, one real text or recording (theme 3); its unknown words go into the schedule | Tue |
| Write | reviews, a short text corrected by Claude, then its mistakes as cards (journey item 3) | Thu |
| Talk | reviews, a conversation with Claude (theme 4); its mistakes become cards | Sat |
| Off | no plan; reviews wait | Sun |

The default totals 4 h 05 a week (the sum of the default minutes). If a sibling feature has not shipped, its kind falls back to Normal and the editor marks it "coming later".

**Missed days.** Missing a day costs only the reviews it carried. Planned minutes never carry over.
- **Off day:** "Day off. 23 reviews are due; they will be in tomorrow's plan." A quiet "Study anyway" button builds a Normal day.
- **Back after a break** (due count over 1.5 × what one day holds): Today takes the most urgent cards first (lowest predicted recall) and spreads the rest over 3 days. There are no new items until one day can hold the reviews, and the slot shrinks to a short read. The notice states the facts and passes no judgement (prototype `?v=back`).
- **Away mode is not offered.** FSRS keeps counting while he is away, and pretending otherwise would be dishonest. The help line under the week says so.

**Mondays** add one line under the hero: "Last week: 4 h 12 on 6 days · 74 learnt · 9 missed." Its numbers tick in (countTo). No modal.

## 2. Goals (exam optional), as additive data on courses

A course already has `goal: {exam, date}` (`settings.courses`, HLC per field path, `setCourse()` its only writer). Every addition below is additive and optional, and a record without them means "no goal of that kind".

```js
course = {
  id, lang, level, decks,
  goal: {
    exam: 'goethe-b1' | null,          // unchanged: the exam goal
    date: 'YYYY-MM-DD' | null,         // unchanged: the ONLY exam date (clock reads it)
    level: 'B2' | null,                // NEW: the level he works towards (≥ course.level)
    by: 'YYYY-MM' | null,              // NEW: optional month for the level goal
  },
  dates: [ { id, label, date, script: scriptId | null } ],   // NEW: a talk, a trip, a meeting (ids UUIDv7)
  week: { min: [45,45,20,45,30,60,0], kind: ['n','read','light','write','n','talk','off'] } | null,   // NEW, Mon…Sun
}
```
- **HLC paths:** `courses.<id>.goal.level`, `.goal.by`, `.dates.<did>.{label,date,script,deletedAt}` (dates are united by id and a deleted date keeps its tombstone), and `.week.min` and `.week.kind` (each written whole). `settings@1` gains these fields in the same commit (records check). `mergeSettings` needs no new rule.
- **Minutes per day:** `budget(day) = week.min[dow] ?? settings.minutesPerDay`. `minutesPerDay` stays as the fallback, and onboarding writes both. The clock is unchanged; the allowance gains an input `dayKind`.
- **Exam goal:** as today. Phase comes from `goal.date`; without a date there is no countdown but the mocks stay available. The Exam tab shows while `goal.exam` is set.
  - "Move" changes only the date, and the copy says what moves: "60 days left. Exam weeks start Sat 29 May…". This is already safe (moving the date never writes a card; ARCHITECTURE §5).
  - "Remove" after the exam clears `goal.exam` and `goal.date`, hides the Exam tab and keeps every attempt.
  - **Exam weeks** (new, M): 14 days before the date, the B1 exam-week behaviour starts (mocks first, side decks pause), so a B2 exam in June does not make April an exam month. Today `phase()` turns `week` on for any date ahead, which suited a 2-week sprint and does not suit years. Change: `phase = 'none'` until exam−14, then `week`, `lastNew`, `eve` and `day` as now. Golden vectors: the clock vectors gain cases for dates more than 14 days ahead; the existing cases stay byte-identical.
- **Level goal:**
  - New items prefer the goal level: 40 % of new items at `goal.level`, the rest at or under `course.level`, by frequency. This needs the B2 layer (theme 2); until then it is a no-op.
  - Its progress line is "30% of the B2 items known (450 of 1,508)", where the denominator is the map's items at that level.
  - The estimate is a range, never a promise. Bootstrap the weekly net change in that level's known count over the last 8 full weeks, then show the P10–P90 date at which 80 % would be known. Hide it with fewer than 4 weeks of log, or when the pace is ≤ 0 ("No estimate: B2 known has not grown in 8 weeks").
- **A date with a script:** from 21 days before the date, that script's steps come before new items (priority 25). In the last 3 days they are the slot every day. After the date it moves to "Past dates" on the goals page.
- **Weekly time** is the week plan's sum. There is no separate target number to keep in sync.

## 3. Where it lives (keep the four tabs)

- **Today.** The hero keeps the due count as its numeral. The 28-day squares are replaced by **this week's strip**: seven columns, height = planned minutes, fill = minutes done, today in accent, kind under each day, and "52 min of 4 h 05 this week". It reuses the runway's drawing (`brand.js runway`) at 7 columns.
  - In maintenance, Where you stand becomes: the known figure + 12-week sparkline + 4-week learnt and missed, A1–C2 level bars (accent = learnt in the last 4 weeks), the level goal card with its range, and **Progress**.
  - The exam module rows move behind "B1 mock results" once the exam is more than 14 days past, or when there is no exam goal.
  - Feedback rows for uncorrected mock writing stop showing 14 days after the exam (they stay on the Exam tab).
- **Progress**, `#/today/progress`, is a child page of Today (back to Today, Today's tab stays current). It is also reached from Profile › Goals ("See progress") and from the map.
  - I recommend no fifth tab: he will open Progress weekly, not daily, and a tab would compete with Practice.
- **Look up › Map** gains **Over time** in the head row: a week slider and Play over the real Atlas or the 3D city, drawn from the weekly frames (§4.3). The Progress page has the compact version and links to it.
- **Profile › Goals and week** replaces Profile › Goal (`#/profile/goal`, same route): the goals list, "Add a goal" (Exam, A date, Level) and the week plan.

## 4. The progress log (the most urgent piece)

Nothing today records a daily picture. The `activity` record has minutes and rounds per day, and per device only the merged maximum. Cards keep the last 12 history entries, and Where you stand computes "known" for *now*. To draw years later, three cheap, additive records start now.

### 4.1 Daily record: kv `progress.<courseId>.<YYYY-MM>` (profile scope, one key per month, about 12 KB)
```js
{ [day]: {
  v: 1, at, deviceId, src: 'live' | 'replay' | 'estimate',
  atlas: '<sha8 of atlas.<lang>>',                  // the map version the counts are against
  known:  { w: [A1,A2,B1,B2,C1,C2], p: [...6], g: n },   // knowledge state 'known' (domain/knowledge.js), words / phrases / grammar
  shaky:  { w: [...6], p: [...6], g: n },
  seen:   { w: [...6], p: [...6], g: n },                // any card, any state
  of:     { w: [...6], p: [...6], g: n },                // denominators on that day (the map grows with releases)
  day:    { learnt, lapsed, reviews, again, newShown, firstTry: [right, asked] },
  due:    { now, overdue },                              // after the day's last round
  min:    { total, by: { review, new, write, speak, read, talk, build, script, exam } },
} }
```
- **Writer:** `data/progress.js`, from one pure function `domain/progress.js dayRecord({cards, atlas, day, activity})`, the same counting as Where you stand (one definition of known).
  - **When:** on round done, on Today's render (at most once an hour), and on the first open of a new study day. That last write finalises yesterday from the cards as they are now, which is exact, because nothing changed since yesterday's last review.
  - **Cost:** the knowledge pass over a few thousand cards takes a few ms.
- **Sync:** add `'progress.*': 'progressDays'` to `SNAPSHOT_KV` (backup.js), with merge rule `progressDays`: per day the record with the larger `at` wins. Export includes it.
  - About 150 KB a year raw, a few KB gzipped in the snapshot.
  - Nothing personal beyond counts. It goes to the private results repo only, never into the public repo or fixtures.
- **Per course:** `progress.fr.*` works the same way for French, with the course's own pool as `of` (French has no map; levels from the course file). No German strings, as the pack architecture requires.

### 4.2 Minutes by kind and by device (additive on `activity`)
`activity[day] = { minutes, rounds, by?: {kind: min}, dev?: {deviceId: min} }`. `addActivity(store, day, {minutes, rounds, kind})` gains `kind`. A mixed round splits its minutes by review/new item count.

**Finding:** `restore.js joinActivity` takes the *larger* minutes per day across devices. A day studied on the phone and the Mac therefore counts only one device's minutes. With `dev`, the merge unites per device and `minutes = Σ dev`, and days from before `dev` keep the max rule. Without this fix his hours per week will be undercounted.

### 4.3 Weekly map frames: kv `progress.<courseId>.frames.<YYYY>`
`{ atlas: sha8, ids: n, weeks: { 'YYYY-MM-DD'(Monday): base64(2 bits per atlas item: not seen, learning, shaky, known) } }`.
- Size: 5,872 items × 2 bits ≈ 1.5 KB a week, about 80 KB a year.
- It is written on the first open of each week and feeds Map › Over time.
- A map release (`build-atlas --repack`) changes ids and positions. Frames are therefore keyed by atlas sha, and the time-lapse maps old frames through the old id table, which is shipped with the release as `atlas.<lang>.ids.<sha8>.json` (ids only, about 60 KB). Frames stay valid across releases.

### 4.4 Backfill (yes, mostly exact)
A one-time job (`data/progress-backfill.js`) runs in a module worker (CSP `script-src 'self'` allows it), in chunks while the app is idle, and records `progress.meta = {backfilledAt, from, exactFrom}`.
- **From 5 Oct 2026 on: exact.**
  - The progress backup has written a daily snapshot of all cards, `data/snapshots/<device>/<day>.json.gz`, since 5 Oct. Each snapshot gives that day's counts directly, with `today = day`.
  - Days without one carry the previous day's cards forward. That is exact for counts, because recall decays deterministically with no review.
  - Where several devices exist, replay `card.reviewed`/`marked_known` events in their total order on top (the same order the merge uses, `domain/cardmerge.js`).
  - Locally, the outbox plus the `archive` store holds every event since the cutover, so the backfill also works offline for this device.
- **23 Sep to 4 Oct: estimated, `src: 'estimate'`.** Replay each card's `first` and `hist` (complete for cards with ≤ 12 reps, true for nearly all of them then). The Igloo placement marks have no dates, so they land on 4 Oct as one labelled jump ("Imported from Igloo"). The charts draw these days dotted with a note.
- **Minutes:** `activity` covers days since the migration. Before that, `doors.b1.days.v1` (rounds only) gives study days without minutes. External tracked hours (§4.5) can cover earlier days.
- **Map frames:** computed by the same replay, one per Monday since 23 Sep.
- **Cost:** a few hundred days × a few thousand cards ≈ about a million recall evaluations, under a second on an iPhone in a worker.

### 4.5 External tracked hours (optional, read-only)
The owner already publishes hours from an external time tracker as a JSON file in a separate public repo. Its shape is `{syncedAt, since, timezone, projects: ['german'], entries: [{id, lang, hours, date, note, source}]}`. A date can have several entries, and `note` holds short tag summaries.
- **How it is read:** through `api.github.com/repos/<owner>/<repo>/contents/<path>` with the raw media type, which the existing CSP `connect-src` allows. It runs once a day and needs no token.
- **Where the repo name lives:** in his settings (`connections.hours = {repo, path, lang}`, Profile › Connections › "Study hours from a JSON file"), never in code. The format is generic (`hours-json@1`: a date and hours per entry, optionally a language).
- **Storage:** cache it in device kv `hours.external` and keep it out of the backup, since it is public already and need not be copied.
- **Display:** shown **only as its own view**: "All tracked (external)" next to "In Fluentish", never added together. The external tracker can already include Fluentish time, so a sum would count it twice. The separate hours dashboard keeps its hours-to-target page, and Progress links to it rather than copying it.

## 5. Screens (phone 390; sample data from the prototypes)

### 5.1 Today, maintenance (`today.html`, variants read / light / write / back)
```
Today                                   Tue 13 Apr
┌───────────────────────────────────────────────┐
│ German · working towards B2                   │
│ 41 due                       (odometer)       │
│ Reviews due today in all your practice        │
│  ▇  ▢  ▃  ▅  ▄  ▆  _    ← plan height, done   │
│  M  T  W  T  F  S  S      fill; today accent  │
│    Read Light Write  Talk Off                 │
│ 52 min of 4 h 05 this week        Edit week   │
│ 0 of 45 min today                             │
└───────────────────────────────────────────────┘
Plan                              About 45 of 45 min
 ○ Review round      41 due · 3 rounds       12 min
 ○ New items         10 new · B2 news and work 8 min
 ○ Read              Die Bahn erhöht die Preise 12 min
 ○ Word building     5 new · prefix ver-      5 min
 ○ Speaking situations 8 due                  3 min
 This week  Wed Light day. Reviews only, 20 min
            Thu Write: a short opinion, corrected by Claude
            Sat Talk with Claude: Wohnungssuche, 20 min
Where you stand
 2,709  words and phrases known, of 5,872   ╱‾ 12 wk
 Last 4 weeks: 168 learnt, 107 missed after being learnt
 A1 ████████████░ 706 of 786   (accent = last 4 weeks)
 …  C2 ░ 1 of 192
 ┌ Goal: B2 by Dec 2027 ─────────────────────────┐
 │ 30% of the B2 items known. At the pace of the │
 │ last 8 weeks: between Nov 2027 and Apr 2028.  │
 │ Today ───────[░░░░|░░░░░]──── (line: your date)│
 └───────────────────────────────────────────────┘
 [Progress]  Months, levels, hours and the map over time
[ Start round 1 of 3 · 12 questions ]   (dock)
```
- **Light day:** the plan holds reviews only, and the sub line reads "Light day: reviews only, no new items."
- **Off day:** no rows; "Day off. 23 reviews are due; they will be in tomorrow's plan." with a quiet [Study anyway].
- **Back after a break:** a notice ("You were away 6 days. 164 reviews are due. Today takes the 58 most urgent…"), no new rows, and "This week" shows the spread.
- **Desktop:** the hero and Where you stand sit on the left and the plan on the right.

### 5.2 Progress (`progress.html`)
```
‹ Today
Progress
[12 weeks | 6 months | All]            <first day> to today
+880 known, net    1,043 learnt     85 h in Fluentish
Words and phrases known        (line, 0-based, ◆ milestones,
 3,000 ─────────────────────●   dotted = estimated, crosshair)
 Nov Dec Jan Feb Mar Apr                     [Show as a table]
By level   share of each level known, every chart 0 to 100%
 A1 706 of 786 ▁▁▁▁▁●   A2 742 of 972 ▁▂▂▂●   (2 × 3 small multiples)
Map over time    Week of Mon 12 Apr: 2,709 known
 [cell field by level, new this week in accent]  [Play] ━━━━●
Hours per week   [In Fluentish | All tracked (external)]
 ▆▅▇▆▇▄▇▆▅▇ … ▃(this week, accent)  ── week plan line
 Average of the last 8 full weeks: 3 h 10 a week. [Show as a table]
Study days  Studied on 146 of 203 days since 23 Sep. Last 12 weeks: 5.2 days a week.
 [calendar field, 4 ink steps, today outlined]
Milestones  ◇ A1: 90% of its 786 items known      Next
            ◆ 2,500 words and phrases known       Wed 3 Mar
```
- **Charts follow the dataviz rules.** One measure per chart and no dual axis: hours are either In Fluentish or external, chosen with a segmented control.
  - Thin marks: 2 px lines, columns ≤ 24 px with 4 px top radius, hairline solid grid, and a single series with no legend box.
  - Every chart has hover/focus tooltips and a "Show as a table" twin. The weekly table doubles as the **Strava-style log**: week, minutes, days, learnt, missed, and kinds done ("Read 2 · Write 1 · Talk 1").
- **Colour follows DESIGN.md.** Known = ink, accent = you/now (today's point, this week's column, new this week), never green.
  - The study-days ramp is three ink steps validated with `validate_palette.js --ordinal`: light `#a2a4a8 #6a6d74 #2c2e36` on canvas, 2.27:1 at the light end; dark `#4a4d56 #8b8e97 #d6d7dc`, 2.29:1. Both pass.
  - "No study" is `cell-empty`, the same as the field.
- **Two documented deviations from the dataviz defaults:**
  - The headline numbers stay Newsreader, as the app's one-numeral rule requires.
  - Estimated days are drawn dotted. That is the "projection" meaning dashes carry, which is honest here and is said in a note.
- **Map releases** that change denominators get a hairline marker on the known chart: "Map grew by 1,508 B2 items".
- **Desktop:** two columns. The real build should size charts from their container width so axis text stays at 11 px; the prototype scales its SVG.

### 5.3 Profile › Goals and week (`goals.html`, variants: no exam, adding an exam, exam set, exam passed)
```
‹ Profile
Goals and week
Goals   Goals decide what Today puts first. None is required,
        and changing one never changes a card.
 Level   Reach B2 by Dec 2027                 [Edit]
         30% of the B2 items known (450 of 1,508) ▃▃▃░░░░
 A date  A talk · Thu 3 Jun                   [Edit]
         Script: Mein Projekt. From Thu 13 May its steps come first.
 Time    4 h 05 a week                        [Edit week]
 Add a goal  (Exam) (A date) (Level)
 ┌ Add an exam ─────────────────────────────────┐
 │ (Goethe B1) (Goethe B2●) (telc B2) (DELF B1) │
 │ Date (optional) [12 Jun 2027]                │
 │ · Adds the Exam tab, mocks and a countdown   │
 │ · From 14 days before: mocks and the weakest │
 │   module first; side decks pause new items   │
 │ · Moving or removing the date later changes  │
 │   only these dates. What you learnt stays.   │
 │ [Add exam]  Cancel                           │
 └──────────────────────────────────────────────┘
Week plan   4 h 05 a week. Light: Wed. Read: Tue. Write: Thu. Talk: Sat.
 Monday   (Off)(15)(20)(30)(45●)(60)(90)
          (Normal●)(Light)(Read)(Write)(Talk)
 …
 [callout] Away for a while? Reviews still come due. When you are back…
```
- Exams other than Goethe B1 are listed as "coming later" until their definitions ship (ARCHITECTURE §3.4).
- On a phone the chips scroll in their own row with the edge fade used elsewhere.

## 6. Motion moments (each once per event, every one dropped under reduced motion)
| Moment | What moves | Spec |
|---|---|---|
| Back on Today after a round | today's week column fills; "N of 4 h 05 this week" ticks | `fill` 640 ms ease-out from the old minutes; countTo 600 ms |
| First Today of the day | the known figure rolls (odometer); the level bars' accent segments grow | odometer as now; bars `fill`, 28 ms stagger |
| A milestone crossed in a round | one line on the round-done screen ("2,500 words and phrases known. Reached today.") rises with the done hero; the ripple runs on the field as now | no extra burst (DESIGN: no confetti). On the next Progress open, that ◆ lands on spring-pop |
| Progress, first open of the day | the known line draws left to right | 900 ms, `--ease-out`; range switches crossfade 240 ms and never redraw |
| Map › Over time, Play | weekly frames play in about 4 to 6 s; cells known that week light in accent, then settle to ink | Atlas: per-frame state texture swap. 3D: the palace rise per frame (later). Scrubbing is instant |
| Monday "Last week" line | numbers tick | countTo |
| Back after a break | nothing moves | a plain notice |

Reduced motion means end states only: Play is replaced by the slider and the line appears drawn. Nothing loops or moves at rest.

## 7. Effort and risks

| Piece | Effort | Notes |
|---|---|---|
| Progress log writer (`domain/progress.js`, `data/progress.js`, SNAPSHOT_KV rule, schema, export) | **S–M** | pure + node tests; vectors for `dayRecord` |
| `activity.by` + `activity.dev` and the merge fix | **S** | additive; restore test with two devices on one day |
| Backfill worker (snapshots, events, hist estimate, frames) | **M** | fuzz against the live writer: a backfilled day = a live day |
| Week plan + day kinds in the allowance and composer; Off/Light/back-after-break; sustainable new rate | **M** | golden vectors for `allowance()` gain week cases; old cases byte-identical |
| Goals model (`goal.level/by`, `dates[]`, `week`), Profile › Goals and week | **M** | settings schema + HLC paths + mergeSettings tests |
| Exam weeks (phase none until exam−14) | **S** | clock vectors gain cases; copy |
| Today maintenance hero (week strip), Where you stand maintenance, remove "in a row" | **S–M** | e2e: Today after an exam, with no exam, Off day |
| Progress page (5 charts, tables, milestones) | **M** | axe on charts; table twins; light/dark |
| Map › Over time (frames on the Atlas; 3D later) | **L** | release id tables; memory budget on iPhone |
| External hours connection | **S** | generic `hours-json@1`; mocked in e2e |

**Risks**
1. **"Known" falls after a break.** The line dips because recall decays. That is honest, but it can sting. Mitigations:
   - "learnt" (which only rises) sits beside it;
   - the dip is marked with the days he was away;
   - Where you stand never shows a negative 4-week figure without its learnt count.
2. **Denominators move.** Map releases (B2 layer, theme 2) add items, so every record stores `of` and the atlas sha, and the charts show shares against that day's own total.
3. **Two devices on one day.** Each writes its own record from its own cards; the larger `at` wins after the merge, and the next start writes a corrected record. Activity minutes need the `dev` fix, or hours are undercounted (§4.2).
4. **Backfill credibility.** Pre-5-Oct days are estimates. They are flagged `src: 'estimate'`, drawn dotted, and never used to date a milestone.
5. **Estimates read as promises.** The level ETA is a range, is hidden with too little data, and says "at the pace of the last 8 weeks".
6. **Sustainable rate feels slow.** The row says why, and a chosen number overrides it. The 55 % limit sits in `budget.js` with a test.
7. **Sibling dependencies.** Read and Talk days need themes 3 and 4. Until then they fall back to Normal and the editor marks them "coming later".
8. **Privacy.** The progress log is counts only, in the private backup. The external hours repo path lives in settings, not code. Fixtures stay synthetic, and the prototypes' data is generated.
9. **Exam habits.** Removing an exam must never hide past attempts: the Exam tab hides, the data stays, and Profile › Data lists it.

## 8. Build phasing

**Phase 0 (this week, before anything visual). Start recording.** Progress log writer + `activity.by/dev` + snapshot rule + schema + export. Ship it alone and quietly. Each day it is not live is a day that can only be rebuilt from snapshots.
- Gates: unit tests, records check, `npm run test:tz`, privacy, the backup round-trip e2e with a `progress.*` key.

**Phase 1. Backfill + the honest Today.**
- The backfill worker.
- The maintenance Today: week strip, "in a row" removed, exam rows folded 14 days after, Where you stand (known + sparkline + level bars).
- `phase` none until exam−14.
- The week plan with default minutes only: kinds Normal, Light and Off, back-after-break, sustainable new rate.

**Phase 2. Goals and week.** Profile › Goals and week; the level goal (progress line + range) and dates with scripts; the exam as an add/move/remove goal with the effects list. Read, Write and Talk kinds switch on as themes 3 and 4 land; Write can ship first (journey item 3 is the free-write corrections becoming mistake cards).

**Phase 3. Progress page.** Known over time, by level, hours (In Fluentish; external hours after their connection), study days, milestones, the weekly log table. Monday "Last week" line.

**Phase 4. Map over time.** Frames on the Atlas with the release id tables, then the 3D rise per frame. French courses get Progress without a map (pool by level).

Each phase keeps the round 3 rules: card ids, IDB names and record shapes unchanged, the backup format additive, golden vectors changed only on purpose (new cases for week plans and exam weeks), grading untouched, plain copy, phone first, reduced motion.

## 9. Copy (new and changed strings, for `en.js`)
| Where | String |
|---|---|
| hero, maintenance | `German · working towards B2`; `52 min of 4 h 05 this week`; `Edit week` |
| removed | `today.inARow` ("{n} days in a row") |
| off day | `Day off. {n} reviews are due; they will be in tomorrow's plan.` · `Study anyway` |
| light day | `Light day: reviews only, no new items.` |
| back after a break | `You were away {d} days. {n} reviews are due. Today takes the {k} most urgent; the rest are spread over the next 3 days. New items come back when one day can hold the reviews.` |
| new items, guarded | `{n} new (fewer this week: reviews are high)` |
| Monday | `Last week: {time} on {d} days · {l} learnt · {m} missed.` |
| goal range | `At the pace of the last 8 weeks you reach 80% between {a} and {b}.` / `No estimate: {level} known has not grown in 8 weeks.` |
| milestone | `{text}. Reached today.` |
| hours source | `From your external time tracker, which can include study outside this app. It is never added to the Fluentish minutes, so nothing counts twice.` |
| exam effects | the four lines in §5.3 |

None of these uses a slogan, an em dash or more than one middle dot per line. German content in the prototypes ("Die Bahn erhöht die Preise", "Homeoffice für alle?", "Wohnungssuche", "Mein Projekt") is correct, and real items come from content.
