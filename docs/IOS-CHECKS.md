# iPhone checks for the platform services

Run these on the iPhone after a change to `src/services/` (speech, voice, audio, share, haptics) or `core/link.js`.
Use the place you study in every day (a Safari tab or the Home Screen icon; they keep separate data). The browser
tests cover the flows in WebKit, but they can't cover the mic, the speaker, the mute switch, haptics or the share sheet.
Each check takes under a minute.

## Mic
- [ ] Practice › Sprechen › Mic check: the first tap asks for the microphone once; it hears a read sentence.
- [ ] A speaking situation with Check with the mic on: it hears the answer and suggests a grade.
- [ ] Teil 2 talk: run 1 records, and the take plays back on the result screen.
- [ ] Exam › Sprechen: a part records, plays back, and shows its length. Lock the phone during a take, unlock: the take is kept.

## Audio, first play
- [ ] After a fresh start (swipe the app away, open it again), the first ▶ on a word in Look up plays at once on the first tap.
- [ ] Mute switch on: note what happens (a recording stays silent; nothing else should break). Mute switch off for the rest.
- [ ] A speaking situation: the line plays when the card opens, or the card says "Tap to play the line." Tap ▶: it plays.
- [ ] A line with no recording (offline): the device voice reads it in German, not a "Multilingual" voice.
- [ ] Script › Listen reads the sentences with a German voice, and the words follow along.

## Hören play limits
- [ ] Exam › Hören › Ton prüfen plays the first clip.
- [ ] Teil 1, text 1: Abspielen plays once, "Zweites Hören in 5 s" counts down, the second hearing starts by itself, then "Keine Wiedergabe mehr" and the button is off.
- [ ] Teil 2: Abspielen starts the reading time; "Lesezeit überspringen" starts the audio. One play only.
- [ ] Reload the page during the module: the used plays stay used.
- [ ] While audio plays, the Teil tabs and Back/Next are locked.

## Haptics
- [ ] A correct typed answer gives a light tap, and the keyboard stays up right after it.
- [ ] Grading a situation or a Word building card gives the same tap.

## Share
- [ ] Profile › Data › Export opens the share sheet with `fluentish-<date>.json`. Save to Files works. Closing the sheet does nothing else.
- [ ] Exam › Sprechen › Save file on a take opens the share sheet with the audio file.

## Device link
- [ ] On the Mac, `b1-token.py --reuse` shows a QR code. Scan it with the iPhone camera: Fluentish opens on Profile with "Device linked.", the address bar shows `#/profile` with no token, and Connections says the device is linked.
- [ ] The QR opens Safari. If you study from the Home Screen icon, link it from Profile › Connections instead (it has its own storage).

## Speaking outdoors

### What went wrong outdoors (diagnosis, round 5)
Read from the code on `main` 5d4aca4, with the platform facts from MDN's browser-compat data (8.1.4) and WebKit:
- **Recognition ends early.** `listen()` was one shot: Safari's recogniser (the Siri engine, `webkitSpeechRecognition`
  since iOS 14.5) ends the session on `no-speech`, on a gust it can't segment, or on a network blip, and the card said
  "Nothing heard". Only the Teil 2 talk restarted it.
- **Low confidence ignored.** Only `results[i][0].transcript` was read. `confidence` (0 to 1, iOS 14.5+) and the other
  `maxAlternatives` were dropped, so a guess in the wind was graded like a clean take.
- **Wrong guesses.** `lang` is fixed to the course locale, so the recogniser doesn't switch language, but in noise it
  maps traffic and wind onto short German words, or keeps English fragments. The check then misses the chunk.
- **The level never drops.** Safari ends an utterance on silence. With wind or traffic there is no silence, so a take
  ran until he tapped stop, and the interim text kept changing under noise. There was no meter to show it.
- **No capture processing.** `recorder.js` asked for `{ audio: true }`. On iOS Safari only `echoCancellation` is
  supported (since iOS 11); `noiseSuppression` and `autoGainControl` are not (MDN BCD), so they are requested as
  plain booleans, which a browser may ignore and never fail on. They help on a Mac.
- **Grading.** `sim.js micCheck` suggested Again whenever the chunk was missing from the transcript, and the table
  said "Wrong". A misheard answer outdoors was a suggested Again; Enter takes the suggestion.

### What the app does now
- The first mic tap in a minute measures the room for about a second ("One moment: checking how loud it is."). A loud
  or gusty room says "It's loud here. Hold the phone closer, or type instead." and offers Hold to talk.
- A level bar under the mic moves while it listens (and while an exam take records).
- A session that ends with nothing heard restarts by itself, up to twice. Hold to talk keeps listening through pauses
  until you let go. A take whose words stop changing for 2.5 s ends by itself, and no take runs past 20 s.
- Every alternative the phone offers is checked; the best one counts.
- When the phone isn't sure (low confidence, a garbled transcript, or a loud room and little of the answer came
  through), nothing is marked Wrong: the card shows what it heard with "Not sure", and "That's not what I said" leads
  to Try again or Type instead. Show answer leaves the grade to you, and Good is suggested.
- Each attempt is logged on this device only (kv `speech.log`: the room's level, confidence, flags; no words, no audio).

### Checks on the street
Use Safari in a tab (the Home Screen icon has no speech recognition). Turn on Check with the mic in a situation round.
- [ ] Quiet room first: the first tap shows "One moment" for about a second, then "Listening". The bar moves when you
      speak and drops when you stop. The answer is checked as before.
- [ ] On a busy street: the first tap says "It's loud here. Hold the phone closer, or type instead." and Hold to talk
      is underlined.
- [ ] Say the right answer at arm's length in the noise. If the phone gets it wrong, the card says "Not sure", never
      "Wrong", and the answer stays closed.
- [ ] "That's not what I said" → Try again works; Type instead takes a typed answer and checks it.
- [ ] Turn on Hold to talk. Hold the mic button, speak with a pause in the middle (or in a gust), let go: both halves
      are in the transcript. A long press opens no menu and selects no text.
- [ ] With the wind on the mic, tap and speak one sentence and stop: listening ends by itself within a few seconds.
- [ ] After a check, the model answer plays at full volume (the mic is released first).
- [ ] The bar and recognition together: if the phone stops hearing you the moment the bar appears, note it. The app
      falls back to listening without the bar for the rest of the visit.
- [ ] Mic check in a loud place: a reading the phone wasn't sure of offers Try again or Keep it.
- [ ] Teil 2 talk outdoors: the bar moves during the run; after a loud run there is no speech rate, and the line
      says why.
- [ ] Exam › Sprechen: the bar moves while a take records; the take plays back.
- [ ] Settings › Accessibility › Motion › Reduce Motion on: the bar steps about four times a second, without the spring.

Unverified on the device, to note when you run these: the confidence values iOS gives (MDN documents the 0 to 1
range; Firefox always reports 1, Safari is not documented), whether the meter's stream and the recogniser share the
microphone (WebKit's source mutes capture in other pages only), and the noise thresholds (`domain/hearing.js NOISE`,
first guesses: median −42 dBFS is loud). `speech.log` keeps the numbers to tune them.

## Round 4 surfaces

Added 7 Oct. Not run yet (ROADMAP › Run the iPhone checks backlog). Use synthetic or your own data; note results
here as ticks, or as an item in `docs/ROADMAP.md`.

### Explore 3D at 120 Hz
- [ ] Look up › Map › 3D on the iPhone (ProMotion): orbit and zoom feel smooth, with no visible stutter while the
      city settles. Diagnostics or Safari's Web Inspector timeline shows frames near 120 per second while moving, and
      the page goes idle (no frames) when nothing moves.
- [ ] Back from a round started with "Study the gaps here": the learned moment plays once, then the scene is still.
- [ ] Low Power Mode on: it still runs (at 60 Hz) without the phone getting warm in a minute of use.

### VoiceOver in the Reader and Progress
- [ ] Practice › Reading, a graded text: VoiceOver reads the text as prose, sentence by sentence, not one word button
      at a time. The interactive layer (tap a word) is reachable and announces the word.
- [ ] The word sheet: focus moves into it when it opens and back to the word when it closes; Save is announced.
- [ ] Today › Progress: each chart has a name, and its table twin reads the same numbers. The range switch and the
      sources are reachable in order.

### Conversation on the real API
- [ ] With a Claude key: a Free chat reply appears word by word (streaming), not all at once after a pause.
- [ ] Stop during a reply, and leaving the page during a reply: the chat stays usable, and Profile's spend line moved.
- [ ] End the session: the feedback card appears; its mistakes are things you actually wrote.
- [ ] The spend shown matches the provider's usage page for that day, within a few cents.

### The week sheet
- [ ] Profile › Goals and week on the phone: tapping a day opens its sheet; minutes and kind change with 44 px
      targets; the keyboard never hides the sheet's buttons; closing it returns focus to that day.
- [ ] Today's week strip shows the change at once, and a past missed day looks different from a planned future one.
