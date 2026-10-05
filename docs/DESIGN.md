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
  x-new: "#84868d"                        # not seen, italic; 3.3:1
  x-bar-new: "rgba(20,21,25,0.13)"        # not-seen bar at far zoom
  x-today: "{colors.accent}"              # practised today, always with a hairline under it
  x-glow: "accent 26% on canvas"          # the plate under a word just learned (fades in 1.3 s)
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
  x-new: "#6f7178"
  x-bar-new: "rgba(236,235,230,0.12)"
  x-glow: "accent 34% on canvas"

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
  odometer:       { mask: "bottom fade only: #000 0-84%, transparent 96%" }
  primary-width:  "phone 100%; desktop min(100%, 360px)"
  study-card:     { backgroundColor: "{colors.surface}", rounded: "{rounded.card}", padding: "24px 20px 20px", shadow: card, viewTransitionName: fx-card }
  answer-field:   { border: "bottom 1px {colors.field-border}", typography: "{typography.input}", caret: "{colors.accent}", height: 52px }
  tile:           { rounded: "{rounded.tile}", background: "role colour at 13% (17% dark) on surface", underline: "3px inset role colour" }
  segments:       { height: 4px, gap: 3px, rounded: 2px, done: ink, miss: bad, now: accent }
  ring:           { stroke: "5.5/100 of size", caps: butt, gap: 5deg, arc: ink, today: accent }
  field:          { cell: "7px phone / 9px desktop; 6px round strip; 5px round-done", gap: "2px (1px at 5px)", rounded: "{rounded.cell}", notStarted: "cell-empty + 1px hairline-strong outline" }
  runway:         { bar: "22-64px by planned minutes (62% under 420px)", fill: "cell-plan + 1px field-border inset", rounded: 4px, today: "accent outline + accent fill", exam: "14px diamond, ink", forcedColors: "CanvasText outline and fill, Highlight today" }
  toast:          { backgroundColor: "{colors.ink}", textColor: "{colors.on-ink}", rounded: "{rounded.pill}", position: "fixed, above tab bar" }
  tab-bar:        { position: "fixed bottom on phone, inline links >=900px", current: "ink label + 18x2px accent dash", glass: "92% canvas + blur; solid canvas under prefers-reduced-transparency" }
  dock:           { position: "fixed above the tab bar on phone (<900px)", use: "Today and Practice's one Start button; the element itself, never an aria-hidden copy", scrollPadding: "html scroll-padding-bottom covers dock + tab bar" }
  grade4:         { layout: "4 equal columns, gap 8px", height: 64px, rounded: "{rounded.ctl}", background: "{colors.surface}", border: "1px {colors.hairline-strong}",
                    label: "Geist 15/600 ink", interval: "{typography.caption} ink-3 tabular", suggested: "6px accent dot top-right, no fill; takes the focus",
                    picked: "ink fill, on-ink text, 420ms spring-pop; the others 0.3", keys: "1-4, Enter/Space = the suggestion",
                    use: "Speaking situations, Word clusters (say it aloud), Scripts: the only self-grade control (src/features/practice/selfgrade.js)" }
  done-hero:      { parts: "label, one figure (typography.figure) + 'of N' line, the atmosphere breathing once, one data object", dataObject: "field strip | letter | ready-meter row | cluster layout | chat bubbles",
                    rule: "one big numeral per screen; a second count is title size and ticks with countTo", code: "src/features/practice/done-hero.js" }
  round-progress: { segments: "the cards planned at the start, fixed widths", again: "2px ticks under the segments (ink-3 40%), appended with land", count: "'3 of 8', 'Again · 8 of 8'", code: "src/features/practice/progress.js" }
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
- **Atmosphere** (`--atmo-1..4`): near-canvas tones with a faint cobalt cast. Only behind the Today hero.
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
- **Study days**: last 28 days as squares; today outlined in accent, filled when the day's minutes are done.
- **Word tiles**: role tint at 13% (17% dark), 3px role underline, optional mono role label. `.tile.gap` for the missing chunk.
- **Toast**: ink pill above the tab bar, optional Undo, 4 s.

## Explore (Look up › Map)

Explore (`src/features/explore/`, `#/lookup/map`) is a map of every word, phrase and grammar concept in the content, grouped by a chosen mode, showing what the learner knows. It is the one screen where the field idea (one mark per item, inked by knowledge) becomes the whole page. It lives under Look up (an entry card at the top of Look up) rather than as a fifth tab: it is a way of looking things up and choosing what to study, and the tab bar stays at four.

**Form.** Each group is a round paragraph of German set in the map font (a vendored Newsreader instance without kerning or ligatures, `src/vendor/newsreader-map/`), words in level then frequency order, with a ring around it. Groups sit on a fixed spiral, largest first. Positions come from content only and are computed at build time (`tools/build-atlas.mjs` → `content/atlas/de.json`) from the font's advance widths, so every device breaks the same lines and the map never moves as the learner learns. A rebuild keeps every shipped position: new items take new lines at the end of their paragraph, inside 6 % headroom; a group without room asks for a repack, which is a map release. Source is the one mode laid out on the device (it depends on where items were met); its groups grow at their end.

**Encoding.** Ink is the scale; shape is the second channel. Known: ink. Shaky: ink-3. Not known: x-unknown text in an open box (the mark's open tile). Not seen: pale italic. Practised today: accent with a hairline under it. At far zoom every word is a bar of its exact width in the same styles (filled, grey, outlined, faint, accent). The group ring shows the four states as arcs from 12 o'clock. Nouns always carry their article at 72 % in ink-3. Known is never green; role colours never appear on the map. The study lists in the sheets use the same encodings, with the state in words for screen readers.

**Semantic zoom.** Overview: bars, group names centred in their discs. 6.5 to 9.5 px: bars crossfade into type, drawn from per-group bitmaps cached per half-octave zoom tier. From 9.5 px: type, and the "where you are" pill names the group under the centre. A tap on a word opens its card (Opposite and Same family links fly to that word); a tap on a group flies to it and opens its sheet.

**Modes.** Topic (talking-and-writing phrases grouped by kind; grammar as its 67 concepts), Word family, Opposites (primary pairs, a hairline inside each pair), Level, Word type (der, die and das nouns apart), Source (mock exams, scripts, speaking, practice rounds, Igloo, Look up). Items not in a mode fade out in place. One place per item per mode; second memberships are links in the card.

**Study.** The group sheet's "Study next" lists the ten most useful words not yet known (not known, then shaky, then not seen; each by frequency). "Study these N words" starts a cluster round in Practice (`#/practice/round?kind=cluster:pick&ids=…`); groups that are Practice clusters also link to them. Explore never writes card state. "Gaps only" dims known and shaky items to 16 %.

**Chrome.** Back to Look up, title, Map/List segmented control and Find in the head; mode chips in one scrolling row (tapping the current mode frames the whole map); legend, total, Gaps only and zoom over the bottom of the map. The sheet is a bottom sheet on a phone (over the tab bar, its buttons sticky) and a 380 px card at the top right of the map from 720 px. The List view lists the same groups and items with states in words and is the accessible alternative to the canvas.

### Explore motion

- First open of the day: groups ink in from the middle outwards (28 ms group stagger, 420 ms per word, about 1.5 s). Once per day.
- A word learned today, the first time the map shows it: it settles in cobalt on a soft accent plate that shrinks on spring-pop and fades over 1.3 s (at least 14 px tall, so it shows at overview too).
- Mode switch ("flow"): words fly to their new paragraphs on spring-soft, groups assembling from the middle out, delay up to 200 ms plus 90 ms jitter; leaving words fade at 2.2x; rings and names after 55 %. The camera frames the new map, or follows the selected word when it stays.
- Camera flights: van Wijk smooth zoom, cubic in-out, 380 to 1,100 ms by distance.
- Reduced motion: no reveal, no glow, no inertia; mode switches are 140 ms crossfades; the camera jumps.
- Don't loop, drift or rotate at rest; the canvas draws only while something moves.


## Earned moments (round 2)

Each runs once per event, never at rest, and is dropped under reduced motion (the end state appears at once).
- **Map flow** (Explore mode switch): as described above. It is the reference quality for the rest.
- **Pair snap** (Word clusters, after a round): the pairs and words that changed land one after another, 140 ms apart, each 560 ms on spring-pop; a snapped pair's link draws in, an accent plate (x-glow) fades under it over 1.3 s; a haptic tick for the first three; the count starts with the first landing.
- **Line landing** (Build an email): the page scrolls to the line's slot and settles first; the line then flies by translation only on a 6 px arc (520 ms, spring-soft), never scaled; its connectors light at 90 ms steps, the task point lands; then the action row scrolls back into view.
- **Word lift** (Scripts, marking a word): 420 ms spring-snappy to the new tray item; the tray text changes on arrival; the count digit lands.
- **Situation card**: the line types in word by word with the audio, the model answer arrives as a reply bubble, the grades rise in on a stagger.

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

**Performance**: the shader is the only WebGL context (one per page, max), mounted after idle, low-power, pixel count capped at 900x900, speed 0 at rest. The field canvas runs rAF only while animating. No scroll listeners: reveals use IntersectionObserver. Total kit cost: about 5 kB + 5 kB gzipped JS, 8 kB gzipped CSS, plus Paper Shaders' mesh gradient (lazy, CDN, optional).

## Copy

- Labels name the thing: "Exam in", "days", "Readiness", "Known today", "Start round", "Show answer", "Check", "Next", "Days in a row". No slogans, metaphors, "X, not Y", lists of three, exclamation marks, or praise on correct answers ("Great job!"). The green check is the praise.
- Dates come from the user's exam date: "Goethe B1 exam", "Fri 9 Oct", "6 days". Never hard-code the date in copy.
- Numbers carry units. Empty states say what is missing and what to do ("No exam date set. Add it in Settings to see the countdown.").
- At most one middle dot per line. No em or en dashes in UI text.

## Do's and Don'ts

- Do keep the field and runway honest: each cell is a real item, each column a real day with real minutes.
- Do keep the input focused between cards on iPhone (swap prompt text, not the input element).
- Do use the accent only for "you, today, progress". Never as a fill wider than a runway bar, never on timers.
- Do set German sentence text in Newsreader wherever it is read (prompts, examples, lists); Geist only for typed input and tiles.
- Do keep the exam runner and its start panel German, in Sie; everything around them is English.
- Don't add confetti, particle bursts, sounds, streak flames or emoji. The ripple is the celebration.
- Don't animate on page load beyond the one-time field intro and odometer roll. Returning to Today should feel instant.
- Don't use role colours outside the grammar layer, or green for "known".
- Don't add 3D libraries. Paper Shaders mesh gradient is the only runtime dependency, optional, and the CSS gradient in `.atmo` is a finished look on its own.
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
