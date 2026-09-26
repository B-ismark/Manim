# Screen reader check — Manim

**Time:** about 10–15 minutes per screen reader.
**You need:** the device you're testing, plus a second device (a laptop or another phone) to play "the other person" for the waiting-room and chat steps.
**Site:** https://manim.i-ai.workers.dev

A screen reader reads the screen out loud for people who can't see it, and lets them move around by gestures or keys instead of by looking and tapping. You are checking one thing: **could someone who can't see the screen start a call, take part, and leave, using only what they hear?**

Automated checks already catch missing labels. What they can't catch is how the call *sounds* to use: things said twice, things never said, focus jumping to the wrong place. That's what this script is for.

**How to fill it in:** tick the box if you heard roughly what's in "You should hear". If not, write down what you actually heard in the notes line, even when it's messy. Exact words help most.

> **Minutes:** every device in a call uses some of the monthly LiveKit allowance (5,000 participant-minutes on the free plan). Two devices for 15 minutes is about 30 minutes of it. Leave the call once you're done.

---

## Part 1 — Turning it on and the few moves you need

Practise the moves for a minute on any web page before you open Manim.

### VoiceOver on iPhone (Safari)

**On/off:** Settings → Accessibility → VoiceOver. Faster: Settings → Accessibility → Accessibility Shortcut → tick VoiceOver. After that, **triple-click the side button** turns it on and off.

> Tip: once VoiceOver is on, a single tap only *selects* something. You need a double-tap to press it. If you get stuck, triple-click the side button to turn VoiceOver off.

| To do this | Gesture |
|---|---|
| Next / previous item | Swipe right / swipe left with one finger |
| Press the selected item | Double-tap anywhere |
| Hear what's under your finger | Touch and drag one finger around the screen |
| Jump by landmark or heading | Twist two fingers like a dial (this is the **rotor**, a menu of ways to move) until you hear "Landmarks" or "Headings", then swipe down / up |
| Go back / close a panel | Two-finger "Z" scrub (a quick zig-zag) |
| Stop talking | Two-finger tap |

A **landmark** is a named area of the page, like "Call controls". It lets a screen reader user jump straight to it instead of swiping through everything.

### VoiceOver on Mac (use Safari)

**On/off:** **Cmd + F5**. On a Mac with Touch ID, hold Cmd and press Touch ID three times quickly.

"VO" means holding **Control + Option** together.

| To do this | Keys |
|---|---|
| Next / previous item | VO + Right arrow / VO + Left arrow |
| Press the item | VO + Space |
| Move between buttons and fields | Tab / Shift + Tab |
| Jump by landmark | VO + U opens the rotor. Use Left/Right arrows until you reach "Landmarks", Up/Down to pick one, then Enter |
| Close a dialog or panel | Esc |
| Stop talking | Control |

### NVDA on Windows (optional, use Chrome or Firefox)

**On:** Ctrl + Alt + N (if the installer created the shortcut), or start it from the Start menu. **Off:** Insert + Q, then Enter.

| To do this | Keys |
|---|---|
| Next / previous item | Down arrow / Up arrow |
| Move between buttons and fields | Tab / Shift + Tab |
| Next landmark | D |
| Next button / heading | B / H |
| Press | Enter or Space |
| Type into a field | NVDA switches to typing on its own when you Tab into a field. If keys don't type, press Insert + Space |
| Close a dialog or panel | Esc |
| Stop talking | Control |

---

## Part 2 — The walk-through

Do this once per screen reader. Where it says "phone" or "desktop", the app really does behave differently: phones have no keyboard shortcuts, and the control bar hides itself.

### 1. Landing page

1. Open https://manim.i-ai.workers.dev (sign in with your approved account first if it asks. New meeting only works for approved accounts while the private beta gate is on).
2. Swipe or arrow through the page from the top.

**You should hear:** a heading "Manim" (or "Welcome back, [your name]"). Then "Call name or invite link, text field". Then "Join, dimmed button" (it's dimmed until you type something). Then "New meeting, button".

- [ ] Landing heard as expected
  Notes / what I heard: ______________________________________

### 2. Toast test (a quick one while you're here)

A **toast** is a small message that pops up for a few seconds and then disappears.

1. Type `!!!` into "Call name or invite link" and press Join.

**You should hear:** "Call names need letters or numbers".

- [ ] Toast was read out
  Notes (was it read at all? after a delay? only when you swiped to it?): ______________

Clear the field before you go on.

### 3. Start a call

1. Find and press **New meeting**.

**You should hear:** the prejoin screen (the "get ready" screen before you enter a call). Its heading is "Joining", then the call's name.

- [ ] Heard the call name on the prejoin screen
  Notes: ______________________________________

### 4. Prejoin: name, camera, microphone

1. Swipe through the prejoin screen.
2. Press the microphone button, then the camera button, and listen after each press.
3. Clear the name field. Then find Join now.
4. Type your name back in.

**You should hear:**
- "Share invite link, button"
- "Mute microphone, button". After pressing it, the button should now say "Unmute microphone"
- "Turn off camera, button". After pressing it, "Turn on camera"
- "Your name, text field"
- "Join now, button" (dimmed while the name is empty)
- "Low-bandwidth, switch" and "Encrypted link · Manim doesn't record calls · Privacy"

- [ ] Mic and camera buttons say their new state after pressing
- [ ] With the name empty, it's clear *why* Join now won't work (known gap: today it's just dimmed, with no hint)
  Notes: ______________________________________

Leave the microphone **on** and the camera however you like.

### 5. Join and hear the call name

1. Press **Join now**.

**You should hear:** after a short "Joining" moment, the screen reader lands on "In call" and reads the call's name as a heading. You shouldn't have to go hunting to find out where you are.

- [ ] Landed on "In call" and heard the call name
  Notes (where did focus land? was there silence?): ______________________________

### 6. Find the call controls

1. **iPhone:** twist the rotor to "Landmarks", then swipe down until you hear "Call controls".
   **Mac:** VO + U → Landmarks → "Call controls".
   **NVDA:** press D until you hear "Call controls, region".

**You should hear:** "Call controls". Then, as you move into it: "Mute microphone", "Turn off camera" (desktop: an "Audio options" and a "Camera options" arrow next to each), "Open chat, collapsed", "More options", "Leave call". On desktop you'll also hear "Share screen" and "Reactions and raise hand". On a phone there's an "Audio settings" or "Audio output: …" button.

- [ ] Could jump straight to Call controls
- [ ] Every button had a sensible name (none just "button")
  Notes: ______________________________________

### 7. Mute and unmute

1. Press **Mute microphone**. Wait two seconds.
2. Press it again (now called **Unmute microphone**).

**You should hear, once each time:** "Microphone muted" / "Microphone on". It should **not** say "pressed", "selected" or "toggle button". You may also hear the button's new name ("Unmute microphone"). That's fine, but note it if the same news comes out twice and gets in the way.

- [ ] New state announced, and only once
- [ ] No "pressed" or "selected"
  Notes (exact words, in order): ______________________________________

### 8. Chat: open, send, close

1. Press **Open chat**.
2. Move to the message box, type "hello from the screen reader test", then press Return (or the **Send message** button).
3. Close chat. **Phone:** press the **Close panel** button (or do the two-finger Z scrub). **Desktop:** press Esc.

**You should hear:**
- On opening: a panel called "Chat", with tabs "Chat" and "People", and a message box called "Message"
- After sending, your message appears (it may or may not be read out; note which)
- **On closing: you're back on the "Open chat" button.** This is the main thing to check. Focus shouldn't drop to the top of the page or into nowhere.

- [ ] Chat opened with a clear name
- [ ] Message sent
- [ ] After closing, focus went back to the "Open chat" button
  Notes (where did focus go?): ______________________________________

### 9. People

1. **Phone:** swipe to the "People (1)" button near the top right. **Desktop:** that button, or press P.

**You should hear:** "People (1)", then a list with you in it.

- [ ] People panel reachable and readable
  Notes: ______________________________________

Close it again.

### 10. Change the view (More → View)

1. Press **More options**.
2. Find the "View layout" group and press **Gallery**. Then open More again and press **Speaker**.

**You should hear:** a panel called "More". In the View section: "Speaker" and "Gallery", with the current one marked "selected" (or "on"). After switching, the choice you made should be the one marked.

Also try the view button on the stage itself. It's read as "View: Speaker. Change view".

- [ ] Could tell which view was active before and after
- [ ] Closing More put focus back on "More options"
  Notes: ______________________________________

### 11. Raise your hand

1. **Desktop:** Reactions and raise hand → Raise hand. **Phone:** More options → Raise hand (in the React row at the top).

**You should hear:** the button changes to "Lower hand", and a "Lower hand" button appears near the top of the screen.

- [ ] Clear that your hand is up, and how to lower it
  Notes: ______________________________________

Lower it again.

### 12. Someone knocks (waiting room)

**Setup:** open More options and turn on **Waiting room**.

1. On the **second device** (no screen reader needed there), open the invite link. Use **Share invite link** on prejoin, or copy the address bar of the call. Enter a name like "Sam" and press Join now. That device should show "Waiting to be let in".
2. Back on the screen-reader device, **don't move.** Just listen.

**You should hear, once:** "Sam is waiting to join". Then find the waiting box and swipe through it: "Waiting to join (1)", "Sam", "**Admit Sam**, button", "**Deny Sam**, button". The buttons should include the person's name, not just "Admit".

3. Press **Admit Sam**.

**You should hear:** "Sam joined the call".

- [ ] "…is waiting to join" was announced without you looking for it
- [ ] It was said once, not repeated every few seconds
- [ ] Admit / Deny buttons included the name
- [ ] "Sam joined the call" was announced
  Notes: ______________________________________

**Optional:** do it again with Deny. The second device should show "The host declined your request to join."

### 13. The other person does things

Ask the second device to do each of these while you listen:

- **Send a chat message while your chat is OPEN.** Does the new message get read out? (Open question D below.)
- **Send a chat message while your chat is CLOSED.** It won't be read out. But when you next reach the chat button it should say "Open chat, 1 unread".
- **Raise their hand.** You should hear "Sam raised their hand".
- **Share their screen** (desktop only). You should hear "Sam started sharing their screen", and "Screen sharing stopped" when they stop.

- [ ] Hand raise announced
- [ ] Screen share start/stop announced
- [ ] Unread count on the chat button
  Notes: ______________________________________

### 14. Leave

1. Go to Call controls and press **Leave call**. If you're the host on desktop, there's also an arrow next to it with "End call for everyone". **Don't** use that one.

**You should hear:** "You left the call", with a **Rejoin** button available for about 8 seconds. The second device should hear or show "[your name] left the call".

- [ ] Leaving was confirmed out loud
- [ ] Rejoin was reachable before it disappeared
  Notes: ______________________________________

---

## Part 3 — Open questions to settle

These are the things we don't know yet. They're the most valuable part of your notes.

### A. Can you reach the control bar when it's hidden? (phone only)

On a phone, the control bar slides away after about 4 seconds of no touching, and a tap on the video brings it back. With VoiceOver on:

1. Join, and don't touch the screen for 5 seconds.
2. Use the rotor → Landmarks → "Call controls". Or swipe right through the page until you reach the buttons.

- [ ] **Does VoiceOver still find the buttons** while the bar is hidden? Yes / No
- [ ] If yes: **does double-tapping one work** (e.g. mute)? Yes / No
- [ ] **Does the bar slide back into view** when you land on it? Yes / No
- [ ] Is anything read out that you *can't* see or use?
  Notes: ______________________________________

(The worst case is that VoiceOver reads "Mute microphone" but double-tapping does nothing.)

### B. Does a video tile keep talking while people speak?

Each video tile can be selected. Its name includes things like "muted", "hand raised" and "speaking".

1. Swipe onto the **other person's** tile and stop there.
2. Ask them to talk, pause, and talk again for 20 seconds.

- [ ] Does the screen reader **re-read the tile every time they start or stop speaking**? Yes / No
- [ ] If yes, how often, and is it annoying enough that you'd move away? ______________

### C. Are toasts read out on iPhone?

You tested one in step 2 and one at Leave (step 14).

- [ ] iPhone reads toasts: always / sometimes / never
- [ ] Mac reads toasts: always / sometimes / never
- [ ] NVDA reads toasts: always / sometimes / never
  Notes: ______________________________________

### D. Are new chat messages read out while chat is open?

From step 13.

- [ ] New messages from the other person **are read out** while chat is open: Yes / No
- [ ] If yes: with the sender's name? Just once?
- [ ] "Sam is typing" was read out: Yes / No / Didn't notice
  Notes: ______________________________________

---

## What to send back

- This file with the boxes ticked and the notes filled in. One copy per screen reader.
- For anything surprising, a **screen recording with sound** (iPhone: Control Center → Screen Recording, long-press it to turn the microphone on. Mac: Cmd + Shift + 5 → Options → Microphone). The spoken output is the evidence, so the sound matters more than the picture.
- Which device, system version and browser you used (e.g. "iPhone 13, iOS 26, Safari").
