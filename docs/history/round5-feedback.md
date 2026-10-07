# Round 5: the owner's feedback from daily use (6 October 2026)

**Commits:** `a772cfe` … `beb84c7` (27 commits). Historical record; living docs: `docs/DESIGN.md` (Explore's map
header), `docs/SCHEMA.md` (`card.checked`, `known.checks`), `docs/IOS-CHECKS.md` (Speaking outdoors),
`docs/SHARING.md`, `docs/ROADMAP.md`.

## Goal

After using the live app every day, the owner sent screenshots and notes. The round answered them in five lanes
(branches `r5/map-header`, `r5/known-typed`, `r5/voice-outdoor`, `r5/card-bugs`, `r5/share-safe`). There was no plan
document and no separate review round; each lane diagnosed root causes in code before fixing, and wrote them in its
commit messages.

## What shipped

- **The map header** (`a772cfe`, `a5baf33`): two short rows on a phone, one study action over the map that follows
  the screen (Study the gaps here, else the next best group), Group by and Key as panels on a phone.
- **Knowing means producing** (`25e6a78`, `425217a`, `688278a`): Quick sort gains a Produce mode (see the meaning,
  type the German, the grader decides); Learn picks can be rechecked by typing; "I know this" on a card that was said
  aloud asks for a typed check first. Checks are an additive event, `card.checked`, and kv `known.checks`; no card
  changes until the learner acts. Knowledge does not use these checks yet (ROADMAP).
- **Speaking outdoors** (`ea1bf30` … `2f519fd`): the diagnosis first (recognition ended early, confidence and
  alternatives were ignored, no meter, a misheard answer suggested Again), then: a short noise check, a level meter,
  hold to talk, sessions restarted when they end early, every alternative scored, and audio the phone was unsure of
  never marked wrong. Thresholds are first guesses; attempts are logged on the device only, to tune them (ROADMAP).
- **Feedback that names his own errors** (`f8330a4` … `e651f4f`): "is right" shows the phrase written right; an
  accepted word is never struck; the item's rule shows only when it is about an error he made; mistake cards carry
  the words around the mistake, name the kinds of change, and require a capital or comma fix to be typed. One
  Dann/Danach card stopped accepting an unidiomatic answer; bank chunks were left out of the new alternative-sentence
  generator, so their accept lists still need a pass (ROADMAP).
- **Share-safe** (`b33b45c`, `0c516b1`, `d335bb4`): the results repository and the study hours file became each
  profile's own settings with no owner defaults in code, migrated additively for the owner's devices; tokens are
  checked for scope and expiry; device links carry `repo` and `exp`; `docs/SHARING.md` records the audit.
- **An e2e flake fixed at its cause** (`2e141c6`, `beb84c7`): `backup.spec` reloaded while a content read was in
  flight; it now waits until no request is pending.

## What is still open from this round

Requiring `exp` on every device link (the script now sends it), tuning the noise thresholds, knowledge from
production checks, the phrase-bank accept pass, and running the outdoor checks on the street. All are in
`docs/ROADMAP.md`.
