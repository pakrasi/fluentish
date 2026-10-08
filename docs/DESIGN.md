---
version: alpha
name: Fluentish
description: "A daily language study tool, used mostly on an iPhone, that merges Igloo (chunk bank, drill, B1 trainer) and the B1 mock-exam app. It reads like a well-set book page with an instrument panel on it: graphite neutrals, Newsreader for prompts and the one big number per screen, Geist for UI. Ink is the action colour; one cobalt accent marks you, today and progress; five muted role colours belong only to the grammar tiles. Motion is feedback: it confirms an answer, fills progress and carries you to the next card, and it never makes you wait."

colors:                       # light
  canvas: "#f4f4f1"
  surface: "#fcfcfa"          # study card, sheets
  surface-2: "#ebebe7"        # tracks, wells, segmented control
  ink: "#141519"              # text and the primary button fill
  ink-2: "#3e4047"
  ink-3: "#5c5f67"            # captions; 5.8:1 on canvas
  hairline: "rgba(20,21,25,0.11)"
  hairline-strong: "rgba(20,21,25,0.22)"
  field-border: "rgba(20,21,25,0.50)"   # inputs and data outlines: 3.3:1 on surface and on the atmosphere
  on-ink: "#f6f6f3"
  accent: "#2a43d6"           # cobalt: today, progress, focus, links. 6.6:1 on canvas
  accent-ink: "#2237b8"
  ok: "#17784a"               # correct answer
  bad: "#b3261e"              # wrong answer, destructive; always with text
  role-fn: "#93407d"          # word roles: grammar tiles only
  role-door: "#0e7385"
  role-turn: "#a05c06"
  role-glue: "#4a7a1c"
  role-slot: "#b0432a"
  role-plain: "#6b6f78"
  cell-empty: "rgba(20,21,25,0.10)"
  cell-plan: "rgba(20,21,25,0.18)"     # runway planned bar, module tracks; always with a field-border outline
  cell-learning: "rgba(20,21,25,0.34)"
  cell-known: "#2c2e34"
  x-known: "{colors.ink}"                 # Explore map: known item text and bar
  x-shaky: "{colors.ink-3}"               # 5.8:1 on canvas
  x-unknown: "#2b2d33"                    # text inside the open box
  x-box: "rgba(20,21,25,0.50)"            # open box and outlined bar; 3.4:1
  x-new: "#6b6d74"                        # not seen, italic; 4.69:1 on canvas, 5.03:1 on surface
  x-bar-new: "rgba(20,21,25,0.13)"        # not-seen bar at far zoom
  x-today: "{colors.accent}"              # practised today, always with a hairline under it
  x-glow: "accent 26% on canvas"          # the plate under a word just learned (fades in 1.3 s)
  pg-col: "#6a6d74"                       # Progress columns (history); 4.70:1 on canvas. This week stays accent.
  pg-k1: "#8a8c91"                        # study days light step; 3.05:1 on canvas (ramp #8a8c91 #6a6d74 #2c2e36, --ordinal passes)
  read-saved: "accent 12% on canvas"      # the wash behind a word he saved; the text stays ink
  read-band: "{colors.surface-2}"         # a phrase band, one element per phrase; never a role colour
  wk-plan: "ink 14% on surface"           # the week strip's opaque plan fill (dark: ink 20%), with the field-border edge
colors-dark:
  canvas: "#0d0e11"
  surface: "#15171b"
  surface-2: "#1e2026"
  ink: "#ecebe6"
  ink-2: "#c3c3be"
  ink-3: "#9c9da3"
  hairline: "rgba(236,235,230,0.10)"
  hairline-strong: "rgba(236,235,230,0.20)"
  field-border: "rgba(236,235,230,0.40)"
  on-ink: "#101114"
  accent: "#8d9cff"
  accent-ink: "#a7b3ff"
  ok: "#66d19a"
  bad: "#ff8f85"
  role-fn: "#e08ac6"
  role-door: "#5cc4d5"
  role-turn: "#edb25e"
  role-glue: "#a2cf6c"
  role-slot: "#f0906f"
  role-plain: "#959aa3"
  cell-empty: "rgba(236,235,230,0.10)"
  cell-plan: "rgba(236,235,230,0.22)"
  cell-learning: "rgba(236,235,230,0.34)"
  cell-known: "#d9d8d2"
  x-unknown: "#d6d5d0"
  x-box: "rgba(236,235,230,0.42)"
  x-new: "#7f8189"                        # 4.97:1 on canvas, 4.62:1 on surface
  x-bar-new: "rgba(236,235,230,0.12)"
  x-glow: "accent 34% on canvas"
  pg-col: "#8b8e97"                       # 5.89:1 on canvas
  pg-k1: "#5c5f68"                        # 3.03:1 (ramp #5c5f68 #8b8e97 #d6d7dc)

typography:
  numeral:  { fontFamily: Newsreader, fontSize: "clamp(84px,24vw,168px)", fontWeight: 300, lineHeight: 0.84, letterSpacing: -0.045em, numeric: "lining proportional" }
  figure:   { fontFamily: Newsreader, fontSize: 48px, fontWeight: 300, lineHeight: 1.0, letterSpacing: -0.025em }   # 56px >=720px
  prompt:   { fontFamily: Newsreader, fontSize: 30px, fontWeight: 400, lineHeight: 1.18, letterSpacing: -0.012em } # 36px >=720px
  h1:       { fontFamily: Newsreader, fontSize: 32px, fontWeight: 400, lineHeight: 1.08, letterSpacing: -0.02em }  # 40px >=720px
  h2:       { fontFamily: Newsreader, fontSize: 24px, fontWeight: 400, lineHeight: 1.15, letterSpacing: -0.01em }  # 28px >=720px
  title:    { fontFamily: Geist, fontSize: 17px, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.01em }
  body:     { fontFamily: Geist, fontSize: 15px, fontWeight: 400, lineHeight: 1.55 }
  input:    { fontFamily: Geist, fontSize: 18px, fontWeight: 400, lineHeight: 1.3 }    # answer field; other inputs 16px; never below 16
  label:    { fontFamily: Geist, fontSize: 13px, fontWeight: 500, lineHeight: 1.35 }
  caption:  { fontFamily: Geist, fontSize: 12px, fontWeight: 400, lineHeight: 1.4, numeric: tabular }
  tile:     { fontFamily: Geist, fontSize: 18px, fontWeight: 500, lineHeight: 1.25 }
  mono:     { fontFamily: "Geist Mono", fontSize: 12.5px, fontWeight: 400 }            # role labels on tiles, key hints, diagnostics ids only; never levels
  german-list: { fontFamily: Newsreader, fontSize: 19px, fontWeight: 400, lineHeight: 1.35 }   # lists of German sentences (round done, missed)
  reading:  { fontFamily: Newsreader, fontSize: 20px, fontWeight: 400, lineHeight: 1.72, letterSpacing: -0.003em, measure: 32em }   # the Reader's text; 21px/1.7 >=720px
  reading-mark-suggest: { decoration: "1px dotted, ink 28%, offset 0.28em" }

rounded: { tile: 6px, ctl: 12px, card: 20px, pill: 999px, cell: 2px }
spacing: { 1: 4px, 2: 8px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px, 10: 40px, 12: 48px, 16: 64px, gutter: "16px phone / 24px >=720px", tap: 44px }

motion:
  durations: { press: 90ms, quick: 160ms, base: 240ms, card: 380ms, fill: 640ms, ripple: 720ms, stagger: 28ms }
  easing:
    out: "cubic-bezier(0.22, 1, 0.36, 1)"
    in: "cubic-bezier(0.55, 0, 0.75, 0.2)"
    inout: "cubic-bezier(0.65, 0, 0.35, 1)"
    spring-snappy: "k520 c30, 6% overshoot, ~420ms (CSS linear())"
    spring-soft: "k170 c20, 2% overshoot, ~600ms"
    spring-pop: "k380 c18, 19% overshoot, ~630ms (check mark and landing cells only)"

components:
  button-primary: { backgroundColor: "{colors.ink}", textColor: "{colors.on-ink}", rounded: "{rounded.ctl}", height: 44px, padding: 0 18px, typography: "{typography.label} at 15px" }
  button:         { backgroundColor: "{colors.surface}", border: "1px {colors.hairline-strong}", rounded: "{rounded.ctl}", height: 44px }
  button-quiet:   { backgroundColor: transparent, textColor: "{colors.ink-2}", rounded: "{rounded.ctl}", height: 44px }
  chip:           { rounded: "{rounded.pill}", height: "36px (pointer:fine) / 44px (pointer:coarse)", padding: "0 14px / 0 16px touch", pressed: "ink fill" }
  segmented:      { backgroundColor: "{colors.surface-2}", rounded: "{rounded.ctl}", height: "40px fine / 44px touch (the buttons themselves, thumb inset 3px)", thumb: "{colors.surface}, slides with spring-snappy" }
  timer-bar:      { height: 2px, fill: "{colors.hairline-strong}" }   # a timer is never accent
  callout:        { backgroundColor: "{colors.surface-2}", rounded: "{rounded.tile}", padding: "10px 12px", border: none }   # rule lines; no side stripes
  odometer:       { mask: "top and bottom fade: transparent 0, #000 12%, #000 84%, transparent 96%" }
  sheet-open:     { motion: "translateY(100%) to 0 on spring-snappy (card duration), opacity stays 1; only the backdrop fades; reduced motion: a 140 ms fade", focus: "the sheet's title (tabindex -1, no ring)" }
  primary-width:  "phone 100%; desktop min(100%, 360px)"
  study-card:     { backgroundColor: "{colors.surface}", rounded: "{rounded.card}", padding: "24px 20px 20px", shadow: card, viewTransitionName: fx-card }
  answer-field:   { border: "bottom 1px {colors.field-border}", typography: "{typography.input}", caret: "{colors.accent}", height: 52px }
  tile:           { rounded: "{rounded.tile}", background: "role colour at 13% (17% dark) on surface", underline: "3px inset role colour" }
  segments:       { height: 4px, gap: 3px, rounded: 2px, done: ink, miss: bad, now: accent }
  ring:           { stroke: "5.5/100 of size", caps: butt, gap: 5deg, arc: ink, today: accent }
  field:          { cell: "7px phone / 9px desktop; 6px round strip; 5px round-done", gap: "2px (1px at 5px)", rounded: "{rounded.cell}", notStarted: "cell-empty + 1px hairline-strong outline" }
  runway:         { bar: "22-64px by planned minutes (62% under 420px)", fill: "cell-plan + 1px field-border inset", rounded: 4px, today: "accent outline + accent fill", exam: "14px diamond, ink", forcedColors: "CanvasText outline and fill, Highlight today" }
  week-strip:     { columns: "7, Monday first (brand.js weekStrip), spread to the card's inner width", bar: "max 30px wide, centred, height by planned minutes",
                    states: { done: "ink fill over the plan fill", missed: "the plan fill only ({colors.wk-plan} + field-border edge)", future: "field-border outline, no fill", today: "accent outline + accent-soft, minutes done in accent", off: "1px field-border baseline (a bar of the minutes when he studied anyway)" },
                    labels: "weekday 11px ink-3, kind 10px ink-3 (none for Normal)", plan: "plan mode (the week editor): every day the plan fill", update: "weekStripUpdate: one column grows from its old height (scaleY, spring-soft), its label crosses over" }
  week-editor:    { phone: "the strip, then seven 56px rows ('Thursday  45 min · Write (later)  ›'); a row opens a bottom sheet (rs-sheet) with the minute and kind chips wrapped, one line on the kind, ‹ day / day › steps", wide: ">=720px: the strip's columns are tabs (selected: 1.5px ink inset), the day's editor in a surface panel under them", keys: "roving tabindex: one tab stop, arrows, Home, End", code: "src/features/profile/week-editor.js" }
  progress-column: { width: "min(16px, 55% of slot)", fill: "{colors.pg-col}", top: "4px rounded", now: "accent outline 1.5px + accent 25% fill, labelled 'so far'", average: "ink-2 hairline at the 8-week average, labelled at the right edge only" }
  progress-line:  { endLabel: "the value at the end, Geist 12/600 ink, with a canvas halo", markers: "diamonds and the end dot pop in (spring-pop) as the draw passes them; the label fades in last" }
  progress-row:   { use: "Today › Where you stand: the door to Progress", height: 64px, parts: "title, the last 4 weeks' change (caption, tabular), a 96x28 sparkline of known over 12 weeks (2px ink, accent end dot), chevron", morph: "view-transition-name pg-known on the sparkline and on Progress's known chart" }
  reader-head:    { parts: "h1 (Newsreader 30, 34 >=720px), one meta line ('Graded text at B1, 241 words · 90.5% known'), a 3px meter (ink known, surface-2 track, no legend), a caption only for a stretch or a hard text and for 'assumed from your level'" }
  reader-marks:   { suggested: "{typography.reading-mark-suggest}", saved: "ink text on {colors.read-saved} (+2px of the same as a halo); a 4px accent dot after the word in the tray only", band: "{colors.read-band}, one element across the phrase's words and spaces" }
  toast:          { backgroundColor: "{colors.ink}", textColor: "{colors.on-ink}", rounded: "{rounded.pill}", position: "fixed, above tab bar" }
  tab-bar:        { position: "fixed bottom on phone, inline links >=900px", current: "ink label + 18x2px accent dash", glass: "92% canvas + blur; solid canvas under prefers-reduced-transparency" }
  dock:           { position: "fixed above the tab bar on phone (<900px)", use: "Today and Practice's one Start button; the element itself, never an aria-hidden copy", scrollPadding: "html scroll-padding-bottom covers dock + tab bar" }
  grade4:         { layout: "4 equal columns, gap 8px", height: 64px, rounded: "{rounded.ctl}", background: "{colors.surface}", border: "1px {colors.hairline-strong}",
                    label: "Geist 15/600 ink", interval: "{typography.caption} ink-3 tabular", suggested: "6px accent dot top-right, no fill; takes the focus",
                    picked: "ink fill, on-ink text, 420ms spring-pop; the others 0.3", keys: "1-4, Enter/Space = the suggestion",
                    use: "Speaking situations, Word clusters (say it aloud), Scripts: the only self-grade control (src/features/shared/selfgrade.js)" }
  done-hero:      { parts: "label, one figure (typography.figure) + 'of N' line, the atmosphere breathing once, one data object", dataObject: "field strip | letter | ready-meter row | cluster layout | chat bubbles",
                    rule: "one big numeral per screen; a second count is title size and ticks with countTo", code: "src/features/shared/done-hero.js" }
  round-progress: { segments: "the cards planned at the start, fixed widths", again: "2px ticks under the segments (ink-3 40%), appended with land", count: "'3 of 8', 'Again · 8 of 8'", code: "src/features/shared/progress.js" }
  letter-slot:    { empty: "1px field-border baseline rule + 12px ink-3 label at its end; 40% wide for greeting, closing, sign-off", current: "2px accent rule", filled: "Newsreader 18/1.5 ink" }

layout:
  column-list: 760px     # Practice, Exam, Look up, Profile, word and topic pages
  column-wide: 1120px    # Today two columns from 960px, exam runner split from 960px
---

## Overview

Fluentish is one tool with one daily loop: open Today, see how far the exam is and what is due, do a round, see readiness move. The look is quiet so that the moments that move are the ones that matter.

The brand idea is the sentence built from chunks. It is carried by things on screen, never by copy:
- **The mark** is four word tiles in two lines; three are set, the last is an outline still to be filled.
- **The wordmark** is "Fluent" in Newsreader with "ish" in Newsreader italic, ink-2. Same family, no second font.
- **The grammar tiles** (inherited from Igloo) are the only place colour carries meaning about language.
- **The readiness field** is one square per item in the exam pool, in the order items were introduced, so it fills like a line of text being written.

Sibling to Language Stack: same Newsreader-light numerals, same "one accent, the art is the data" rule, same Paper Shaders atmosphere used once. Fluentish is cooler (graphite and cobalt where Stack is near-black and amber) and light-first, because it is read in daylight on a phone.

Dials (taste-skill): VARIANCE 4, MOTION 5, DENSITY 5. App UI, not a landing page: predictable layout, motion only as feedback and state change, a brand layer on Today only.

## Colors

- **Ink is the action colour.** Primary buttons are ink on canvas (on-ink text). This keeps the screen calm and leaves colour free for meaning.
- **Accent (cobalt) means "you, now"**: today's column in the runway, today's gain on the ring, cells known today, the current round segment, the caret, focus rings, links, the active tab dash. Never a large fill, never a button background, no glow.
- **ok / bad** appear only for answer feedback and destructive actions, always next to text or a check/strike.
- **Role colours** (fn, door, turn, glue, slot, plain) are data colours for the grammar layer: tiles and their legend only. Never on chrome, charts or buttons. One written exception: in Build an email the connectors in a line are marked in `role-glue`, because a connector is exactly what that role names.
- **Who is who in a conversation**: the other person's voice and bubble are ink and surface-2; the model answer ("what you could say") is a surface bubble with a thin accent edge (45 %), never an accent fill. Its chunk is a dotted ink-3 rule, not an accent underline (that reads as a link).
- **Feedback on a right answer is never red.** A capital or umlaut to fix shows the word once with the changed letters underlined in accent, and a caption ("Capitals: Damen, Herren."). Red is for real misses only.
- **Cells** (empty, learning, known) are ink at three strengths. "Known" is quiet ink, never green, so a full field looks finished rather than loud.
- **Atmosphere** (`--atmo-1..4`): near-canvas tones with a faint cobalt cast. Only behind the Today hero. The CSS gradient in `.atmo` is drawn as the shader's first frame (cobalt at the top and bottom of the right edge, a softer cast at the left middle), and the canvas fades in over it (--dur-fill, opacity only), so the hero does not change colour after load.
- Light canvas is a neutral paper (#f4f4f1), not cream. No warm beige, no brass.
- All text pairs pass WCAG AA on canvas and surface in both themes (checked: lowest is role-glue light at 4.66:1, ink-3 light at 5.8:1).

## Typography

- **Newsreader** (Google Fonts, variable opsz 6-72, 300-500 + italic): the one big numeral per screen (weight 300), secondary figures, the study prompt (400), h1/h2. Justified because this is a reading and language product and it ties to Language Stack; it is not the default "creative = serif" reach.
- **Geist** (Google Fonts, 400-650): all UI, body, labels, answer input, tiles. **Geist Mono** only for role labels on tiles and keyboard hints.
- Target-language text: German and other Latin-script languages use the context font (Newsreader in prompts, Geist in tiles and answers). Devanagari, Bengali and Arabic switch to Noto Sans Devanagari / Noto Sans Bengali / Noto Naskh Arabic by `lang` attribute (tokens.css), loaded only when that language is active.
- Big numerals: proportional lining figures. Captions, timers, counts in rows: tabular. Odometer digits: tabular (columns must not jitter).
- Inputs never below 16px (iOS zoom). The answer field is 18px.
- Self-host the three families before launch (download from Google Fonts, `font-display: swap`, preload Geist 400 and Newsreader 300). The kit links Google Fonts for convenience.

## Layout

- Single column on phone, 16px gutter plus safe-area insets. Max content 1120px; two columns from 960px where content pairs naturally (Today: countdown + next round; Progress: ring + field).
- Today, top to bottom: hero (countdown numeral linking to the exam date, runway, today's minutes), phase notice, import notice, Feedback, Plan, Readiness (figure, field, legend, one line defining the number), Modules. On desktop: hero and Modules left, Feedback, Plan and Readiness right. The sticky button on phone starts the first unfinished Plan row and uses that row's words.
- List pages use one 760px column; Today and the exam runner use the wide layout.
- Bottom tab bar on phone (fixed, translucent, 44px targets), inline links at the top from 900px.
- Sections separate with 40px and a hairline, not boxes. The study card is the one elevated surface in a round.
- Direction: write inline spacing and position with logical properties (`margin-inline-start`, `padding-inline`, `inset-inline-end`, `text-align: start`), never left/right, so a right-to-left course mirrors (`tests/unit/lang-dir.test.mjs` lists the few physical exceptions). Study-language text carries `lang` and `dir` (`core/lang.js`).

## Keyboard mode (round 6)

He types on an iPhone many times a day, so the screen with the keyboard open is a layout of its own, owned by
`src/core/keyboard.js` (the only module that reads `visualViewport`; `tests/unit/keyboard-lint.test.mjs` keeps it so).
- **Variables, not measurements.** `--vv-h`, `--vv-top` and `--kb` on `<html>`; `body.kb` while a text field has the
  focus and a keyboard over 120 px is up. A full-screen typing screen is a `fitToKeyboard()` box (`.kb-fit`: height
  `--vv-h`, following `--vv-top`), so its last row sits on the keyboard and iOS has nothing to pan.
- **Chrome gives way.** In `body.kb`: no app bar, tab bar, docks or hints; a round's header is one 32 px row (segments or
  track, count, End); no safe-area padding at the bottom.
- **One row on the keyboard.** Every typing screen ends in the field, then at most three 44 px buttons, quiet ones first
  and the primary at the end. The field sits at the bottom of the column (sticky), and feedback, the answer key and the
  sentence to retype open **above** it and are revealed (`reveal()`). The prompt is 22 px, at most three lines (a tap
  shows all of it); a mistake card's task and context two.
- **A short prompt uses the empty band.** While nothing but a plain "Right" is open on the card, a prompt of up to 64
  characters (`fitPrompt()`, `.kb-short`) grows toward the prompt size with the visible height (30 px from 400 px up,
  never under 22) and sits in the middle of the space above the field. Once feedback opens it is 22 px at the top again.
  The field and its row stay where they are on every card; a long prompt keeps 22 px and three lines.
- **Quick sort** in Produce: the Check/Learn tiles become a tally in the header ("Check 3  Learn 1") and a row of Skip,
  Learn and Check; the mode switch and Undo wait for the keyboard to close.
- **Pages with a form** keep their chrome; the action row docks on the keyboard (`.kb-dock`), a header that must stay is
  held at the top of the visible screen (`.kb-stick`, the exam runner), and the page gains room at its end
  (`--kb-screen`) so a low field scrolls up instead of iOS panning the page. Return does the expected thing: a form
  submits, a title moves to the next field (`enterMovesTo`), the composer sends; `enterkeyhint` says which.
- **The keyboard stays up.** One persistent field per round (Word building too); every button on a typing screen keeps
  the focus (`keep` / `keepFocus`); a field is never made read-only while focused.
- **Motion.** Only the class toggle animates: what stays on screen slides to its new place in 200 ms on spring-snappy
  (`motion.js kbShift`), returning hints fade in; reduced motion swaps at once. Nothing animates on the per-frame
  viewport events.

## Elevation & Depth

- Flat by default. Three elevations only: `shadow-card` (study card), `shadow-lift` (toast, popovers), `shadow-sheet` (bottom sheets). Shadows are tinted to the neutral, never pure black on light.
- The top bar and tab bar are translucent with blur; under `prefers-reduced-transparency` they become solid canvas.
- Z layers: atmo 0, content 1, bars 30, sheet 60, toast 70, fx 80.

## Shapes

One written rule: tiles 6px, controls (buttons, inputs, segmented) 12px, cards and sheets 20px, chips/tracks/toasts pill, field cells 2px, runway bars 4px. Ring arcs use butt caps so the module gaps stay exact.

## Components

All in `styles/components.css`. The kit demo page stays with the design work (design/kit/kit.html), not in this repo.
- **Study card**: meta row (kind, "3 of 12"), prompt in Newsreader, optional hint, answer baseline field with check icon slot, actions (Show answer quiet, Check primary with Enter hint on keyboards). The `<input>` persists across cards: only the prompt text changes inside a view transition, so focus and the iOS keyboard stay up between cards.
- **Round segments**: one 4px segment per question; done ink, miss bad, now accent (short stub).
- **Readiness ring**: one arc per exam module (Lesen, Hören, Schreiben, Sprechen), ink; today's gain is the accent end of each arc. Overall percent in the centre as an odometer. Module rows below with 4px tracks.
- **Readiness field**: canvas (aria-hidden; the figure and the line under it carry the data), one cell per item of the B1 pool, introduction order. Known = recalled with 90% or more on the readiness day; Known today = known and practised today (accent). Legend: Known, Known today, Learning, Not started. It appears on Today, as a strip of the round's items in the round header, and on the round-done screen.
- **Countdown runway**: one column per day from (today minus up to 2) to the exam; bar height is planned minutes, fill is minutes done; today accent; exam day a diamond labelled "Exam". Switches to weeks when the span is over 35 days. Driven entirely by the user's exam date setting.
- **This week** (round 4, Today without an exam in its window): the week strip, seven runway columns Monday first; height is the day's planned minutes from the week plan (minutes a day without one), fill is the minutes done, today in accent, an Off day a baseline, the kind under each day. Under it "52 min of 4 h 05 this week" (countTo) and the kind of day in one line ("Light day: reviews only"). There is no count of days in a row: the week is the measure, and a missed day costs only the reviews it carried. The hero states today's job, never a debt (round 4): on an Off day the numeral's place says "Day off" (typography.h1) with "12 reviews wait for tomorrow" under it; after a break the numeral is the reviews today takes ("50 today", "of 150 due. The rest are spread over the next 3 days."). After 3 days or more away, "Welcome back. You were away 6 days; today starts with the most urgent." is one ink-2 sentence under the kind of day, rising once a day. Study anyway changes the hero in place: the atmosphere and the strip stay, today's column rises from its baseline and reads Anyway, the count crosses over without an odometer roll, and the plan discloses. The 28-day study-days squares (`studyDays`) remain for onboarding's preview only.
- **Word tiles**: role tint at 13% (17% dark), 3px role underline, optional mono role label. `.tile.gap` for the missing chunk.
- **Toast**: ink pill above the tab bar, optional Undo, 4 s.
- **Word panel** (core/wordpanel.js): every card whose item is one word (exam words, Word clusters, word-list cards, Quick sort). Before the answer a quiet line over the prompt: word type, CEFR level, a 5-bar frequency meter from zipf (ink-2 bars on cell-empty) and "very common / common / less common". After it, on surface-2: the key forms in Newsreader ("ziehen – zog – hat/ist gezogen"; the dashes are the German dictionary convention, content not chrome), "Present: er fährt" when irregular, "Plural: die Zäune", then ONE example sentence with the word in semibold over a 2 px accent underline, and its source ("From Test 2 · Lesen") or its English. A prompt never shows its answer: forms of the answer in a gloss become "…".
- **Where you stand in maintenance** (round 4): the map's known count as a figure, known by level (A1 to C2, 4px tracks: known in cell-known, the last 4 weeks' gain from the progress log in accent, with a key), the level goal card (share of that level known; no date estimate until the log holds 8 weeks), and the exam's mock rows folded behind one "Goethe B1 mock results" button (motion.js disclose) once the exam is more than 14 days past, far ahead or gone.
- **Goals and week** (Profile, #/profile/goal): goal cards (kind, what, one action, what follows), "Add a goal" chips, an inline panel for an exam with its effects listed (it opens with `motion.js disclose`), the B2 gate as one row per strand (name, state, a 4 px meter of the way to the gate; stacked on a phone, side by side from 720 px, at most 520 px), and the week editor (components.week-editor): the week strip in plan mode over seven rows on a phone, each opening a day sheet with wrapped chips, or the strip's columns as tabs with the day's editor under them from 720 px. A kind whose feature has not shipped has a dashed chip, "(later)" in the row and a line that says it is planned as a normal day.

**Reading** (Practice › your material, `src/features/practice-read/`, `src/features/shared/textview.js`). The text is the page and the calmest thing in the app: typography.reading at 32em, the head first (components.reader-head), the marks of components.reader-marks. The dock holds Study / Read on (a compact segmented control), the tray and Questions; it sits in the page's own column so it starts where the text starts; with nothing saved the tray says "Tap a word". The word sheet rises (components.sheet-open), its quote is a callout. For a screen reader the text is prose: words are spans; the text block is one tab stop, the arrow keys or Enter step into the words and only the word in hand is a button. The library: his texts first, then the graded texts one level at a time (B1 · B2 · C1, his goal level first), each with level, length, his coverage on a 3 px meter and a check when read, sorted by fit.

**Conversation feedback** is a done hero (components.done-hero, without the atmosphere: the page is text): the topic, the words he wrote as the figure, "In 3 messages · 4 min", and the conversation in miniature as the data object (one 6 px bar per message by length, his outlined in accent, Claude's surface-2, a 2 px bad tick under a message of his with a mistake). Topics and scenes are a hairline list; the selected row has a 2 px ink edge at its start; a scene's goal opens under it. The composer (helper chips and the field) is one block on the canvas with a hairline.
- **Practice groups** (features/practice/hub.js, round 3): under the now card (the plan's next row with its button, the due and new counts), three groups: Exam modules ("Skills" without an exam goal), Words, Your own material. The heading is one button (h2 type, 44 px, the due count as a trail, a chevron that turns); the rows open and close with the answer reveal's motion (`motion.js disclose`: grid rows 0fr to 1fr and a fade, at once with reduced motion), and a closed group is inert. A group with work today opens by itself; his own choice on the device wins.
- **Round size sheet** (features/shared/picker.js): before a round of a Practice list. "Practice all" waits behind a quiet "More choices" button unless it was the last choice for the list. A bottom sheet (surface, r-card top corners, shadow-sheet, grab handle) on a phone, a 440 px card from 720 px. Three 56 px options, the selected one outlined in ink with its key (1, 2, 3) filled: Recommended with its count in Newsreader and one line on why; Custom with a 44 px stepper and "of N"; Practice all N. A plain note on surface-2 when the choice adds new items beyond today's allowance. Start is the primary button with the question count and minutes. Motion: the sheet rises on spring-snappy (card duration) and leaves in 160 ms ease-in; the number ticks 45 % up or down on spring-snappy; reduced motion keeps only the fade. Press and hold a list starts Recommended at once (the tip shows on touch only).

## Word families and Today's family (round 7)

`src/features/build/family.js`, `today.js`, `fword.js`; `styles/features/family.css`; the model and the board are pure
(`src/domain/wordbuild-family.js`). The owner's decisions of 8 Oct 2026: tiles first (typing optional), the count only
("7 of 10 found", no ranks, no streaks, no sharing), a 6-word board on a Light day, the family view its own Word
building page linked both ways with the Map's family group and from every word sheet.
- **A word** is drawn the same everywhere: the article at 72 % ink-3, a separable verb's joint (a 1.5 px field-border
  line where it comes apart), an inseparable verb's weld (a 1.5 px ink line under it), the stress dot under the stressed
  vowel (the content's index when it has one). Joints and welds on verbs only; the marks are aria-hidden and the word's
  name says them.
- **Word family** (`#/practice/build/family/<root>`): the head, Root · Prefix · Ending, the root chips, the ring (verbs at
  their compass places, solid spoke splits, dotted never splits; Atlas knowledge encodings; the derivability bar under
  each tile; the nouns as 8 px squares outside) over the tree (Splits off / Never splits / From the root itself), the
  tree being the list version. A row opens its card and the word builds itself (motion table of WORDGAMES-DESIGN §8).
  From 900 px the head and ring are a sticky 440 px column. Inside a round it opens as a bottom sheet.
- **Today's family** (`#/practice/build/today`): full screen, fits 390 × 664 without scrolling. Head, the root line, the
  count with one square per meaning (ink first try, hatched later, outlined shown, accent now; also the board button),
  the clue card (meaning, meta, tries, the build row), one status line, the hive (root 88 × 56 ink, prefix tiles
  52 × 40 round it), endings and articles, the thumb row (Delete, Type, Check). Flips: right is ink, a real word with
  another meaning is a dashed outline, not part of it is struck through in ink-3; shape carries every state. Splits /
  Stays replaces the thumb row. Holds (1.5 s, 2.2 s after a missed split) are the same with reduced motion.

## Explore (Look up › Map)

Explore (`src/features/explore/`, `#/lookup/map`) is a map of every word, phrase and grammar concept in the content, grouped by a chosen mode, showing what the learner knows. It is the one screen where the field idea (one mark per item, inked by knowledge) becomes the whole page. It lives under Look up (an entry card at the top of Look up) rather than as a fifth tab: it is a way of looking things up and choosing what to study, and the tab bar stays at four.

**Form.** Each group is a round paragraph of German set in the map font (a vendored Newsreader instance without kerning or ligatures, `src/vendor/newsreader-map/`), words in level then frequency order, with a ring around it. Groups sit on a fixed spiral, largest first. Positions come from content only and are computed at build time (`tools/build-atlas.mjs` → `content/atlas/de.json`) from the font's advance widths, so every device breaks the same lines and the map never moves as the learner learns. A rebuild keeps every shipped position: new items take new lines at the end of their paragraph, inside 6 % headroom; a group without room asks for a repack, which is a map release. Source is the one mode laid out on the device (it depends on where items were met); its groups grow at their end.

**Encoding.** Ink is the scale; shape is the second channel. Known: ink. Shaky: ink-3. Not known: x-unknown text in an open box (the mark's open tile). Not seen: x-new italic (4.5:1, it is read as text). Practised today: accent with a hairline under it. At far zoom every word is a bar of its exact width in the same styles (filled, grey, outlined, faint, accent). The group ring shows the four states as arcs from 12 o'clock: known ink, shaky ink-3, not known x-box, not seen x-box dotted (every arc at least 3:1). Nouns always carry their article at 72 % in ink-3. A phrase's slot ("dass [Satz]") reads "dass …". Known is never green; role colours never appear on the map.

**Lists** (the sheets' Study next, the List view, search) do not copy the map's boxes and italics, which look like text fields in a list: the state is a 6 px square before the word (filled ink known, ink-3 shaky, x-box outline not known, dotted outline not seen, accent today), the word is plain Newsreader ink, and the state is also in words for screen readers.

**Group names** sit on a plate (surface at 92 %, radius 6, padding 2px 6px): Geist 13/600 ink, at most two lines and 0.86 of the disc across (at least 88 px), the count "k / n" in 12 px ink-3 tabular under it on discs of 60 px and more. Only names that read are drawn: the first line whole, none on discs under 44 px, and where two plates meet the larger disc keeps its name (the other comes back as you zoom). Word family at overview draws its 146 discs as rings, with names for the 12 largest families; a smaller disc's words fade in as it grows past 44 px. A disc without a drawn name shows it in the "where you are" pill when the middle of the map is over it. Rings are drawn before every name, so no ring crosses a plate.

**Semantic zoom.** Overview: bars, group names on plates in their discs. 6.5 to 9.5 px: bars crossfade into type, drawn from per-group bitmaps cached per half-octave zoom tier. From 9.5 px: type, and the "where you are" pill names the group under the centre. A tap on a word opens its card (Opposite and Same family links fly to that word); a tap on a group flies to it and opens its sheet.

**Modes.** Topic (talking-and-writing phrases grouped by kind; grammar as its 67 concepts), Word family, Opposites (primary pairs, a hairline inside each pair), Level, Word type (der, die and das nouns apart), Source (mock exams, scripts, speaking, practice rounds, Igloo, Look up). Items not in a mode fade out in place. One place per item per mode; second memberships are links in the card.

**Study: one path from a group to a round (round 3).** The map is where groups are browsed; the **group page** (`#/lookup/map/<type>/<id>`, `src/features/explore/group.js`) is where a group is studied. It is one page for a map group and for a Practice word cluster (their keys are the same, `topic:food`, `family:fallen`; prefixes, endings and prepositions are clusters only). A group's sheet and its List entry show the group's name, its count, the four states and one button, "Open the group". The page has the header (mode, name, "k of n known" ticking up from the last count shown, the state bar and counts), "Study next" (the ten most useful items not yet known: not known, then shaky, then not seen, each by frequency; each opens the map at that item), the words as they are known (a cluster's own layout: a family's tree, opposite pairs, a block of type; otherwise the group's items as a block of type, at most 300), the rest of a map group that is not in its cluster (a Topic's phrases), and the actions: a cluster's typed round with the round size picker and Say it aloud, else "Study these N words" (`kind=cluster:pick`), phrases or concepts (`kind=pick:`); then "Mark what you know" (Quick sort) and "On the map" (`#/lookup/map?mode=<mode>&g=<key>`, the map on that group with its sheet open). Rounds started there carry `from=map/<type>/<id>`, so End and Done come back to the page. Practice › Word clusters lists the clusters and opens the same page; its old address `#/practice/clusters/<type>/<id>` goes there, and `#/lookup/map?cluster=<type>:<id>` still opens the map on the group. A word card keeps "Practise now", which starts a round of that word from the map. Explore never writes card state. "Gaps only" dims known and shaky items to 16 %.

**Where you stand, and what next.** Under the head row, one status line (13 px, ink-2): "767 known · Next: Food and drink". The number is the same as Today's Where you stand (`shared/data.js wordsKnown`; ARCHITECTURE §5.2); a phone says "767 known" and the whole sentence, "767 of 6,723 words and phrases known", is the first line of Key and groups; from 720 px the header says it whole. "Next" names the group of the current mode with the most common words (zipf 4 and up) he does not know yet at or under his level (`domain/atlas.js nextBestGroup`; a tie goes to the smaller group), ellipsed when long. The name is a button that flies to the group and opens its sheet, where the details are: "189 common words to learn", then "Study 12" (primary: a round of its twelve most common, coming back to it) and "Open the group". The List view and select mode hide the line.

**Chrome (round 5).** The map gets the room: on a phone the header is two short rows, about 96 px with the hairline (it was about 160), and every map control sits with the map.
- Head row (48 px, replaces the app bar below 900 px): the back chevron, "Map" in Newsreader (21 px on a phone, 28 from 720 px), and one view control at the end: the Map · 3D · List segments with Find as its last cell, behind a hairline, on one surface-2 plate.
- Status row (48 px): the status line, and Group by at its end. On a phone Group by is one chip with the current mode and a chevron ("Topic ˅", named "Group by: Topic"); it opens a 220 px panel under it (surface, r-card, shadow-lift) with the six modes as 44 px rows, the current one on surface-2 with a 2 px ink edge at its start. Picking one closes the panel and switches; picking the current one frames the whole map; Esc or a tap outside closes it and focus returns to the chip. From 720 px the six chips sit in the row with a "Group by" label, all visible. The chip that caused a switch (the button on a phone) lands when the words have settled.
- The bottom row over the map (60 px, a canvas fade, lined up with the page column from 720 px): at its start the one study action, a primary button that follows the screen: "Study the gaps here" while a group with words not known fills the middle of the screen (2D and 3D; see the 3D section), else "Study 12" for the next best group (named "Study 12 words of Food and drink"), else nothing. At its end: select mode (the check, 2D only), Key and groups, and − + (and Fit from 720 px) only where there is a pointer (`any-pointer: fine`, from 480 px); a phone pinches, and the + and − keys and the wheel zoom everywhere.
- Key and groups is one trigger and one panel (surface, r-card, over the bottom right of the map). On a phone it holds the whole count, the key (two columns; in 3D the height line under it), Gaps only (2D) and "Go to a group": every group of the mode as a 44 px button with its count that flies there and opens its sheet. From 720 px the key and Gaps only sit in the bottom row itself and the trigger reads "Groups".
- The fit leaves 12 px clear for the rings and uses 0.94 of the free stage on its limiting side, so Level and Source never cut a disc.

**Sheet.** A bottom sheet on a phone with two heights: peek (46 % of the map: the word, its meaning, the example and the sticky buttons; a group's title, count, state bar and "Open the group") and full (min(72 dvh, 560 px)). The grab handle is a button (tap toggles, drag up for full, drag down for peek, further down to close). A camera flight always runs at peek: a link to an opposite or a family word first drops the sheet to peek (240 ms), then the camera flies so the word lands 30 % down the map with a 1.5 px accent ring and an x-glow plate (1.3 s), while the card's content crosses in. From 720 px it is a 380 px card at the top right of the map. Focus moves to the sheet's title when it opens and back to what opened it when it closes.

**List view** (the accessible alternative): every group as a disclosure with the sheet's parts (state bar, counts, "Open the group") and every item with its state square and its state in words; an item opens its card over the List, which stays where it was.

**Keyboard** (the canvas is `role="application"`, roledescription "map", with its keys described): arrows pan, + and − zoom, Tab and Shift+Tab step through the groups in the order they ink in (each one flown to and announced) and leave the map after the last, Enter or Space opens the group Tab reached or the one in the middle, Esc closes the sheet or the Key.

**Memory.** Group bitmaps live inside a pixel budget (10 MP on touch devices, 24 MP otherwise); evicted, stale and unmounted bitmaps have their canvases zeroed at once (WebKit frees backing stores lazily and counts them against a per-page cap), and a frame that alone would need more than the budget draws from a lower zoom tier.

### Explore motion

- First open of the day: groups ink in from the middle outwards (28 ms group stagger, 420 ms per word, about 1.5 s). Once per day.
- A word learned today, the first time the map shows it: it settles in cobalt on a soft accent plate that shrinks on spring-pop and fades over 1.3 s (at least 14 px tall, so it shows at overview too).
- Mode switch ("flow"): words fly to their new paragraphs on spring-soft, groups assembling from the middle out, delay up to 200 ms plus 90 ms jitter; leaving words fade at 2.2x; rings and names after 55 %. The camera frames the new map, or follows the selected word when it stays. When the words have settled, the chip that caused it lands (520 ms, spring-pop, 0.9 to 1).
- A link flight lands with an accent ring and an x-glow plate on the word (1.3 s); the sheet's content crosses in (fade and 6 px rise, base duration).
- A group into its page: the group's disc (a copy of it over the map, ring and name) grows into the page's header plate while the route changes (`core/motion.js handoff`/`receive` inside the route's view transition, `fx-disc`: 520 ms on spring-snappy, the old picture fading as the new one comes in). Reduced motion or no View Transitions: the route's usual change.
- Camera flights: van Wijk smooth zoom, cubic in-out, 380 to 1,100 ms by distance.
- Reduced motion: no reveal, no glow, no inertia; mode switches are 140 ms crossfades; the camera jumps.
- Don't loop, drift or rotate at rest; the canvas draws only while something moves.


### Explore › 3D (the Type city)

The third segment of the map's view control (Map · 3D · List; `?view=3d`, remembered per profile). The Atlas floor plan, raised: every word is a building whose footprint is the word itself, on its own line, at exactly the place the 2D map puts it (the same layout object), so the palace never rearranges and the plan view is the Atlas letter for letter. Height carries one fact, **how long he will remember the word** (FSRS stability; `src/domain/palace.js`):
- known: 3 to 8 floors, one per doubling of stability, `round(log2(S + 1))`, a hairline per floor once a floor is 3 px tall;
- shaky: 1 or 2 floors; not known: an open scaffold one floor high (the mark's open tile, edges only, in `x-box`); not seen: no building, the type printed pale italic on the empty plot;
- practised today: the Atlas accent and hairline on the roof plus a cobalt band at the top of the walls; selected: a cobalt roof outline and a thicker hairline.
State is never carried by height alone: the roofs keep the Atlas type encodings. Districts are the Atlas discs as plinths with the group ring on the rim and around the side. Heights are exaggerated smoothly from 1,200 units away, up to 5× at the overview, so the skyline reads; the card always states recall.

**Light and dark.** White-model shading (walls lit from the upper left, soft contact shadows on the plinths, fog to the canvas). Dark is graphite massing with light type; known roofs glow faintly (ink at 7.5 % on the roof); far away the scaffolds and roof bars quieten further, since light edges on graphite read as noise.

**Level of detail** (all on the GPU): under 5 px the type collapses in the vertex shader and the roof shows the word's bar; between 5 and 8.5 px bars cross into type; floor lines appear from 3 px a floor. Type is drawn from a prebuilt SDF atlas of the map font (`src/vendor/palace-sdf/`), so it is crisp at any angle. District names are DOM plates (as in the Atlas: surface 92 %, Geist 13/600, the count in 12 px ink-3), constant size, the larger group wins a collision, never half off screen, hidden inside the district you are looking at, where the "where you are" pill takes over.

**Camera.** Phone: one finger pans (the ground stays under it, with inertia), two pinch, twist to turn, move up or down together to tilt; double tap zooms ×2.2. Desktop: drag pans, right drag or shift-drag orbits, wheel zooms at the pointer, horizontal scroll turns. The overview frames the whole raised map inside the free stage (measured on the projected rims, so no edge is cut); on a portrait stage it looks down at 52° so the round map also uses the height.

**Motion** (springs are the kit's):
- Map → 3D: the city starts exactly where the 2D map is (plan view, same place, same scale) and tilts to 42°, turning −24°, while the buildings rise district by district from the middle out, then line by line (back-out ease, 8 % overshoot), 1.7 s. From an overview it ends on the whole raised map. 3D → Map is the reverse and lands where the 3D view was looking (on the 2D map's own frame from an overview).
- Fly to a word: log-distance zoom, cubic in-out, 0.55 to 1.5 s, rising on long hops; it ends at 56° with the type about 30 px (34 on a desktop), clear of the sheet. The buildings between the eye and the word **sink** to 12 % while it is selected (the street opens, 0.45 s in, 0.35 s out).
- District entry (a district tapped, from the Districts list or with Tab and Enter): the camera frames the plinth at 45°, the other districts fade toward the canvas to 38 % and lose their names, and the "Study next" words get the open tile hovering over them, dropping in on spring-pop 60 ms apart from 0.55 s.
- **The learned moment**, the single allowed particle burst in the app: the scaffold edges turn cobalt; a cobalt ring runs out across the plinth (1 s); the building rises from its old floors to its new ones on spring-pop with a cobalt line riding up the walls and an x-glow plate fading over 1.3 s; the letters lift off the old roof one after another (40 ms apart) and settle on the new one in cobalt on spring-soft; about 70 fine ink and cobalt motes rise from the base and fall (0.9 to 1.8 s); the neighbours within 260 units bob once. It plays once per word, on return from a study round and, if he missed it, on the next 3D open (a per-device record, kv `palace`). A word he marked known himself (select mode, Quick sort) gets the softer version, without the ring and the motes: no round earned it. Before it plays the camera tours the words in stops that keep the type at least 22 px on a phone (26 on a desktop), 340 ms apart within a stop; the sheet stays closed until the last one has landed, then the district's sheet opens. Words the tour cannot reach settle into their final state. A toast says how many items are now known (an announcement only when a sheet opens next).
- Reduced motion: 3D opens as a 140 ms crossfade to the finished still at its pose; flights jump; no inertia, rise, ring, letters, bob, glow or motes; learned words appear in their final state. Nothing moves at rest, ever: no idle orbit, no drift.

**Access.** The canvas is `role="application"` (roledescription "3D map") with its keys described: arrows pan, + and − zoom, Q/E turn, Page Up/Down tilt, Tab and Shift+Tab step through the districts (each flown to and announced), Enter opens one, Esc closes the sheet. Select mode (mark the words you know) is a 2D tool: its button sits in the bottom row before Key and groups, hides in 3D, and opening 3D ends it. **Key and groups** ("Groups" from 720 px; it said Districts before round 3) lists every group with its count as 44 px buttons that fly there and open its sheet: the keyboard and VoiceOver route, in 2D as well since round 5. Sheets, study actions and focus handling are the 2D map's. **Study the gaps here** (the study action at the start of the bottom row, a primary button; in 2D too since round 5, where it takes the place of Study 12) shows while a district fills the middle of the screen: its words not known yet that a round can ask, the open scaffolds (seen, not known) first, then the empty plots (not seen), each by frequency (`domain/atlas.js gapsOf`, at most 200), go to the round size picker as one list (`#/practice/round?kind=cluster:gaps&ids=…&g=<group>`): Recommended is a round within the day's allowance, or a number, or all. The round comes back to the city on that district. Under forced colours, or without WebGL2, 3D says so in one line and the map stays; a lost graphics context hands back to the map with a one-line note and 3D can be opened again.

**Performance.** Hand-written WebGL2 (`src/features/explore/palace/gl.js`, no library), loaded with `import()` only when 3D opens. Nine instanced draws at most; one RGBA32F item-state texture that every layer reads (a learned word is one 64-byte write); glyph instances packed to 12 bytes; render on demand. DPR capped at 2; while moving, when the 90th percentile frame over 30 frames exceeds 18 ms the render scale steps to 1.5 then 1.25, back up after 240 frames on time, and one full-resolution frame is drawn when motion stops. One WebGL context while 3D is open, released when Explore unmounts.

## Word building (Practice › Word building)

`src/features/build/`, `styles/features/build.css`. Four screens in the order he learns in: the prefix compass (a side view: auf up, ab down, ein forward, aus back, vor forward diagonal, nach back diagonal, zu and an the other diagonals; the dual prefixes as paths, the inseparable ones as "welded on"), the root × prefix Table, the sentence machine and word chains, plus "Split or stay" (60 s) and one mixed review round. Joints and welds are lines, never colour; derivability is shape (solid literal, hatched picture, outlined with a dot word to learn, a small dot no common verb); stress is a dot under the stressed vowel. Accent only for "you, now": focus, the round's current segment, the pin of his derivability guess, the ending just used in the chart (1.3 s). Role colours only on the machine's tiles. Motion (WAAPI with the kit's tokens and `reduced()`, no library): the prefix flies from its chip onto the root (520 ms, 18 px arc) and lands with a joint (3 px settle) or welds (gap closes, line draws, dot pops); the pictogram's object travels its path once; machine tiles FLIP by identity with the particle as the hero (620 ms lift), ge-/zu drop in, a ghost ge- bounces off a welded verb; chain rows rise, the ending slides on, the word type rolls, the article drops with a dotted arc from its ending; Split or stay splits the word into "stem … prefix" or draws the weld. Reduced motion: every moment is its end state (a 140 ms crossfade for machine frames).

## Progress (Today › Progress)

`src/features/today/progress/`, `styles/features/progress.css`, `#/today/progress`: a child page of Today (Today's tab stays current), linked from Where you stand. The long view, drawn from the progress log (one record per study day). Apple Fitness trends and a Strava training log, held to the plain-copy rule: no streaks, no "in a row", no celebration screen; milestones are dated facts.

- **One filter row** (12 weeks, 6 months, All) above everything it scopes: the three summary numbers (known, net change; learnt; time in Fluentish), every chart and the weekly log. The level goal and the milestones read the whole log and say so.
- **Charts** (dataviz method): one measure per chart, one y axis from 0, no dual axis. Lines 2 px ink with the value at the end (components.progress-line); columns per components.progress-column (mid-grey `pg-col`, this week an accent outline labelled "so far", the 8-week average as a labelled hairline); hairline solid grid; axis text 11 px ink-3, tabular. Months carry no year; across a year, January is written as the year in 600 weight. From 960 px the charts that compare sit side by side: Words known | By level, Learnt | Time per week (plot tops aligned), Study days and By kind across the page, Goal | Milestones. Charts are drawn for their container's width (ResizeObserver), so text never scales. The accent is "you, now" only: the last point, this week's column, today's cell. A single series has no legend box.
  - Words and phrases known: a line; estimated days (before the backup's first snapshot) are a dotted ink-3 line with a note (the documented deviation: dots mean "not measured"); Igloo's import and map releases are hairline markers labelled at the top; milestones are ink diamonds with a canvas ring.
  - By level: small multiples, every one 0 to 100% of that day's own pool, a 10% ink wash under the line.
  - Learnt per week, time per week: columns. Time per week shows **either** In Fluentish (with the week plan as a labelled ink-2 line) **or** All tracked (the study hours file); they are never added, because the file includes the time spent here. By kind: small multiples on one shared scale (reviews, new items, practice, mock exams, not split by kind), never a stacked hue palette.
  - Study days: a calendar field, a column per week, three ink steps validated with the dataviz validator (`--ordinal`): light `#8a8c91 #6a6d74 #2c2e36` (light end 3.05:1 on canvas), dark `#5c5f68 #8b8e97 #d6d7dc` (3.03:1). No study is `cell-empty`. Marks: ink 16.6:1, cell-known 12.3:1, accent 6.6:1, ink-3 5.8:1 on the light canvas; 16.2, 13.5, 7.7 and 7.1:1 on dark.
  - The level goal: a sentence with the 10th to 90th percentile months, and a strip from today: the range as an ink band (20%), the middle as a 2 px tick, his month as an ink-2 line. Hidden until 8 full weeks of exact records, with the reason in words.
- **Readout**: hover and the arrow keys move a crosshair (lines) or a highlighted slot (columns, cells) with a small surface card: value first in ink, the day or week under it in ink-3. It is aria-hidden; every chart has a "Show as a table" twin with the same values, and an aria-label that summarises it.
- **Numbers**: the summary figures are Newsreader 28 (title size, not the one numeral) and tick with `countTo`.
- **Motion**: on the first open of a day the known line draws in (900 ms, ease-out), its milestones and end dot landing as it reaches them, and the columns rise (640 ms, the last 8 staggered 28 ms); a range switch crossfades in 240 ms and never redraws. Opening Progress from Today morphs the Progress row's sparkline into the known chart (pg-known). Reduced motion: end states only. Nothing moves at rest.
- **Empty**: one sentence (Geist 15 ink-2) over the Words known frame drawn empty (axis and grid, "Your first week").
- **Forced colours**: marks use CanvasText, the accent marks Highlight.

## Earned moments (round 2)

Each runs once per event, never at rest, and is dropped under reduced motion (the end state appears at once).
- **Map flow** (Explore mode switch): as described above. It is the reference quality for the rest.
- **Pair snap** (Word clusters, after a round): the pairs and words that changed land one after another, 140 ms apart, each 560 ms on spring-pop; a snapped pair's link draws in, an accent plate (x-glow) fades under it over 1.3 s; a haptic tick for the first three; the count starts with the first landing.
- **Line landing** (Build an email): the page scrolls to the line's slot and settles first; the line then flies by translation only on a 6 px arc (520 ms, spring-soft), never scaled; its connectors light at 90 ms steps, the task point lands; then the action row scrolls back into view.
- **Word lift** (Scripts, marking a word): 420 ms spring-snappy to the new tray item; the tray text changes on arrival; the count digit lands.
- **Situation card**: the line types in word by word with the audio, the model answer arrives as a reply bubble, the grades rise in on a stagger.
- **Card lift** ("I know this" on a new card, every round type): the card rises 40 px and fades (300 ms, ease-out) and the next card rises into its place (spring-soft): `swap(…, { kind: 'lift' })`. Reduced motion: a crossfade.
- **Study anyway** (Today, an Off day): today's column rises from its baseline (scaleY, spring-soft), the kind line and the count cross over, the plan discloses (grid rows 0fr to 1fr); the numeral does not roll and the atmosphere does not mount again. Reduced motion: the end state.
- **The week fills** (Today in maintenance, round 4): each column of the week strip fills from the share it showed last time (640 ms spring-soft, 28 ms stagger), so back from a round only that round's minutes fill, and "N of 4 h 05 this week" ticks with countTo. The kind-of-day line cross-fades (base duration) when it changes (Study anyway). "Welcome back" after a break rises in once a day (fx-rise). Reduced motion: end states at once.
- **Known line arrives** (Progress): the draw-in passes each milestone, which pops on spring-pop; the end dot lands last, then its value.
- **Today to Progress**: the Progress row's sparkline and the known chart share `view-transition-name: pg-known`, so the small line grows into the large one (520 ms, spring-snappy). Reduced motion: the route's crossfade.
- **A day of the week changes** (Goals and week): that column of the strip grows or shrinks from its old height (scaleY, spring-soft) and its kind crosses over.
- **Quick sort fling** (Practice › Quick sort): a copy of the word flies on a short arc into the Know or Learn button and shrinks into its count (440 ms), which lands on spring-pop; the next word rises in at once, so input never waits: `fling()` in core/motion.js. Reduced motion: only the counts change.

Done screens (components.done-hero) are ordinary pages: the hero's start() brings the header and tab bar back and unlocks the page scroll (`leaveRound()`), the actions row follows the hero and stays on screen above the tab bar (sticky), and a cluster round shows its own words plus the cluster as a compact field, never the whole cluster as type. `tests/unit/done-screens.test.mjs` guards this.

Rules:
- Chrome (a round's header with its segments and count, the action row, the bars) never leaves the screen while a card swaps: `fx-roundhead` and `fx-roundact` view-transition names with no animation, and the page around the card holds still.
- A progress total never grows mid-round (components.round-progress).
- If an effect happens off-screen or under a sheet, it did not happen: move the scroll, the camera or the sheet first.

## Motion

Purpose first: every animation is feedback (an answer, a tap), a state change (card to card, view to view, a number changing) or a one-time reveal of data. Nothing loops at rest.

**Tokens** are in `kit/motion.css`: durations press 90, quick 160, base 240, card 380, fill 640, ripple 720 ms; stagger 28 ms (max 8 items). Springs are CSS `linear()` curves computed from mass-spring parameters, with `--ease-out` as fallback.

**Choreography rules**
1. Input is never blocked. Transitions resolve their promise as soon as the new DOM is in place; the user can type while the card is still settling.
2. Exits are faster than entrances (160 vs 380 ms) and use `--ease-in`; entrances use `--spring-snappy`.
3. One primary motion per moment. Secondary motion (field ripple, ring) happens off to the side, never in the card.
4. Only transform and opacity (plus SVG dash and the underline clip). No layout animation except the answer reveal (grid rows 0fr to 1fr).
5. Distances are small: 28-40px for cards, 8-10px for reveals, 7px for the wrong nudge.
6. Correct answer sequence (about 450 ms, then auto-advance): underline sweeps green left to right (240 ms), check scales in with the pop spring while its stroke draws, round segment fills (snappy), haptic tick, field cell lands in accent and a faint wave crosses its neighbours (720 ms, runs during the next card). Enter during the hold skips it (`skip()`).
7. Wrong answer: underline sweeps red, the typed text is struck through, the field nudges once (300 ms damped, not a shake), the answer opens below with the differing words underlined in red. The user presses Next; no auto-advance on a miss.
8. Card to card: View Transition on `fx-card`; old card slides 28px left and fades (160 ms), new one comes from 40px right at 98.5% scale with the snappy spring, 40 ms after. Back reverses direction. Fallback without View Transitions: the same keyframes by class.
9. View to view (tabs): `fx-view` content fades out quick and rises 8px in; bars stay still. Give the content wrapper `view-transition-name: fx-view`; the bars must not be inside it.
10. Numbers: the one big numeral per screen is an odometer (digits roll on their own columns, ones place first). Other counts tick with `countTo` (ease-out quart, 600-900 ms).
11. Brand moment: the atmosphere is still at rest. It breathes (speed ramps up, holds 1.6 s, eases out) once when a round is finished, behind the round-done result. Nothing else on Today moves at rest.
12. The only brand motions: the field's intro (once a day on Today), `ripple()` on every first-try correct answer (round strip) and on cells that became known (Today, round-done), and `breathe()` once per finished round. A lost WebGL context falls back to the CSS gradient.

**Reduced motion** (system setting, or `html[data-motion="reduce"]` as a user setting): `--move` becomes 0 so every translate/scale distance is zero; card and view changes become 140 ms crossfades; fills, rings and the runway jump to their values; the odometer and counters write the final number; the field draws its final state with no intro or ripple; the check and underline appear without sweeping; the atmosphere renders one still frame and never breathes. Haptics stay (they are not motion). `html[data-motion="full"]` opts back in.

**Performance**: the shader is the only WebGL context on Today (one per page, max; Explore › 3D holds its own only while open), mounted after idle, low-power, pixel count capped at 900x900, speed 0 at rest. The field canvas runs rAF only while animating. No scroll listeners: reveals use IntersectionObserver. Total kit cost: about 5 kB + 5 kB gzipped JS, 8 kB gzipped CSS, plus Paper Shaders' mesh gradient (lazy, CDN, optional).

## Copy

- Labels name the thing: "Exam in", "days", "Readiness", "Known today", "Start round", "Show answer", "Check", "Next". No streaks or "days in a row". No slogans, metaphors, "X, not Y", lists of three, exclamation marks, or praise on correct answers ("Great job!"). The green check is the praise.
- Dates come from the user's exam date: "Goethe B1 exam", "Fri 9 Oct", "6 days". Never hard-code the date in copy.
- Numbers carry units. Empty states say what is missing and what to do ("No exam date set. Add it in Settings to see the countdown.").
- At most one middle dot per line. No em or en dashes in UI text.

## Do's and Don'ts

- Do keep the field and runway honest: each cell is a real item, each column a real day with real minutes.
- Do keep the input focused between cards on iPhone (swap prompt text, not the input element).
- Do use the accent only for "you, today, progress". Never as a fill wider than a runway bar, never on timers.
- Do set German sentence text in Newsreader wherever it is read (prompts, examples, lists); Geist only for typed input and tiles.
- Do keep the exam runner and its start panel German, in Sie; everything around them is English.
- Don't add confetti, particle bursts, sounds, streak flames or emoji. The ripple is the celebration. One written exception: the ~70 motes of the learned moment in Explore › 3D, the single allowed burst.
- Don't animate on page load beyond the one-time field intro and odometer roll. Returning to Today should feel instant.
- Don't use role colours outside the grammar layer, or green for "known".
- Don't add 3D libraries. Explore › 3D is a thin hand-written WebGL2 layer. Paper Shaders mesh gradient is the only runtime dependency, optional, and the CSS gradient in `.atmo` is a finished look on its own.
- Don't put the atmosphere behind text-heavy screens or the study card.

## Responsive Behavior

- 390px is the design width. Everything fits without horizontal scroll at 320px (runway columns shrink to 3px gaps beyond 20 columns).
- Tap targets 44px minimum; answer field 52px tall; Check button fills the remaining row width on phone.
- From 720px type steps up (prompt 36, h1 40, figure 56). From 900px the tab bar becomes top links. From 960px pairs of sections sit side by side.
- `env(safe-area-inset-*)` on bars, page padding and toast.
- Hover-only hints (keyboard `kbd`) hide on touch devices.

## Iteration Guide

- Tokens live in `styles/tokens.css` and `styles/motion.css` (copied from the design kit); change them and this file together.
- After any colour change, rerun the contrast check for every text token on canvas and surface in both themes, and check cells and runway bars at 3:1 against canvas where they carry meaning.
- Look at the app at 390px in WebKit, light and dark, with and without reduced motion, before shipping a visual change. Tune motion on a real iPhone: WebKit on macOS does not reproduce touch latency or ProMotion.

## Known Gaps

- Icons: none drawn in the kit. Use Phosphor (regular weight) as a self-hosted SVG sprite for the tab bar and buttons; do not hand-draw icons.
- Mark: a first geometric version; worth one review by the owner at 16, 26 and 180px (app icon). An app-icon version should sit on ink with the open tile in accent.
- Haptics on iOS use the `<input switch>` label-click behaviour of Safari 18+; it is undocumented and may change. It is a no-op elsewhere.
- The kit's answer diff only marks missing words; the build needs a proper token diff (and the existing Igloo match.js tolerance rules).
- References used for principles only: an editorial light-serif display with ink buttons and atmosphere-only colour; a strict single-accent surface ladder with hairlines; and Language Stack's own numerals and Paper Shaders atmosphere.

## Build notes (stage A)

- The kit's CSS is copied unchanged into `styles/`; `styles/app.css` holds the shell and screens and uses only kit tokens.
- `src/core/motion.js` is the kit file unchanged. `src/core/brand.js` keeps the kit API and adds `markNode()` (the mark built with DOM calls, since the app never parses markup), an `examLabel`/`minLabel` option on `runway()` for i18n, and loads Paper Shaders from `src/vendor/paper-shaders/` instead of jsDelivr.
- Paper Shaders' default CSS ships as `styles/paper-shaders.css`, so the CSP needs no inline `<style>`.
- `<select>` is not used: WebKit renders it with an inline style that the CSP reports. Few-option choices are chips (`.chip[aria-pressed]`) or the segmented control.
- No amber "no score yet": the role colours stay on grammar tiles only, so unscored modules are ink-3 text.
- Icons: Phosphor regular, as path data in `src/core/icons.js` (Known Gaps above).
