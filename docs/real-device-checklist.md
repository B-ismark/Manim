# Real-device checklist — Manim

**Time:** 20–30 minutes.
**Site:** https://manim.i-ai.workers.dev
**Devices:**
- an **iPhone** in Safari
- a **cheap or older Android** in Chrome (the slower the better: that's where problems show up)
- a **laptop** in Chrome, to host the call and play "the other person"

Our automated tests run on a laptop *pretending* to be a phone. It can't fake a real speaker and earpiece, a phone call coming in, a locked screen, a real keyboard, a battery or a flaky network. This checklist covers exactly those things.

> **Minutes:** every device in a call uses the monthly LiveKit allowance (5,000 participant-minutes on the free plan). Three devices for 30 minutes is about 90 minutes of it. Leave the call on all devices when you're done.

**How to fill it in:** tick a box when it behaved well. When it didn't, capture what the "Send back" line asks for and write one sentence about what you expected. Name files after the check, e.g. `android-keyboard-chat.png`.

**Capturing:**
- iPhone screenshot: side button + volume up. Recording: Control Center → Screen Recording.
- Android screenshot: power + volume down. Recording: Quick Settings → Screen record.
- Laptop recording: Mac Cmd + Shift + 5, Windows Win + Alt + R.

---

## Before you start (5 minutes)

1. On the laptop, open the site and press **New meeting**, type a name, and press **Join now**. You're the host.
2. On the prejoin screen, press **Share invite link** and send the link to both phones (message it to yourself, or AirDrop it).
3. On each phone, open the link, enter a name ("iPhone", "Android"), and press **Join now**.
4. Put the laptop on headphones, or in another room. Two devices on speaker next to each other will squeal and echo, and that tells us nothing about the app.

### How to make the network bad on purpose

You'll need this for checks 13–15.

**iPhone: Network Link Conditioner** (a built-in setting that makes the connection slow or lossy)
1. It lives in **Settings → Developer → Network Link Conditioner**. The **Developer** menu only appears after the iPhone has been plugged into a Mac with Xcode open once (trust the computer when asked). After that it stays.
2. Pick a profile such as **"3G"**, **"High Latency DNS"** or **"Very Bad Network"**, and switch it on.
3. **Remember to switch it off afterwards.** It affects the whole phone.

No Mac? Walk away from the wifi router (a stairwell or the far end of a garden works well), or turn wifi off mid-call to force the switch to mobile data.

**Android**
Android has no reliable built-in slow-network switch. Pick whichever of these you can do:
1. Walk to a weak-wifi spot, as above.
2. Settings → Network → Mobile network → **Preferred network type → 3G** (or 2G), if your phone still offers it. Then turn wifi off.
3. Connect the Android to a Mac's **Internet Sharing** hotspot and run Network Link Conditioner on the Mac. That throttles everything going through it.

(Developer options are unlocked with Settings → About phone → tap **Build number** 7 times. They're useful for "Mobile data always active", but they won't slow the connection down.)

**Laptop: Chrome DevTools**
1. Press F12 (Mac: Cmd + Option + I) → **Network** tab → the dropdown that says "No throttling" → **Slow 4G** or **3G**.
2. **Catch:** this slows down loading the page and joining. It does **not** slow down the live audio and video, which bypass it. To make the *call* bad on a laptop, turn wifi off and on, or use Network Link Conditioner on a Mac (it comes in Apple's free "Additional Tools for Xcode" download).

---

## The checks

### 1. Join time
Time it from pressing **Join now** to seeing yourself in the call. Do it once on good wifi, and once on the bad network later.
- [ ] iPhone: ____ s good / ____ s bad
- [ ] Android: ____ s good / ____ s bad
- [ ] Laptop: ____ s good / ____ s bad

**Send back:** the numbers. A screen recording if any join took more than 10 seconds or showed an error.

### 2. Echo
With the laptop on headphones, have the laptop person talk while each phone is on loudspeaker.
- [ ] The laptop person does **not** hear their own voice come back from the iPhone
- [ ] …or from the Android

**Send back:** a note of which phone echoed, how loud it was, and whether it faded after a few seconds.

### 3. Audio route (speaker, earpiece, Bluetooth)
1. Note where the sound comes out when you first join: the loud speaker at the bottom, or the earpiece at the top.
2. **Android:** on the control bar, press **Audio output: …** (or **Audio settings**) and switch between the choices.
3. **iPhone:** Safari doesn't let web pages choose the speaker, so the button just says **Audio settings**. Use Control Center (long-press the audio card → the AirPlay icon) to switch.
4. Connect Bluetooth headphones **mid-call**, then disconnect them.

- [ ] Sound starts from a sensible place (speaker for a video call)
- [ ] Switching works on Android
- [ ] Bluetooth takes over when connected, and sound comes back to the phone when disconnected
- [ ] Your mic still works after each switch (ask the laptop)

**Send back:** a screenshot of the audio tray on Android, and a note of where the sound came from at each step.

### 4. Rotating the phone
In each view, rotate portrait → landscape → portrait. Change the view with the view button on the stage, or **More options → View**.
- [ ] **Speaker** view: one big video, small ones along the top, nothing cut off
- [ ] **Gallery** view: tiles re-flow, nothing overlaps the control bar
- [ ] While the laptop **shares its screen**: the share fills the stage. People sit on a strip on the right in landscape, and along the bottom in portrait
- [ ] The control bar fits on screen in both orientations

**Send back:** one screenshot per view per orientation (6 in total), from the smaller phone.

### 5. Locking the screen mid-call
1. In a call on the phone, lock it. Keep talking for 30 seconds.
2. Unlock and return to Safari or Chrome.

- [ ] While locked: the laptop could still hear you (yes / no: ____)
- [ ] While locked: you could still hear the laptop (yes / no: ____)
- [ ] After unlocking: your camera comes back by itself, or it's clear what to tap
- [ ] You're still in the call, not kicked back to the home page

**Send back:** a note of the yes/no answers, and a screenshot from the **laptop** of how your tile looked while the phone was locked.

### 6. Switching apps
Same as check 5, but go to another app (Messages, Photos) for 30 seconds instead of locking.
- [ ] Audio behaviour while away: ____
- [ ] Camera and mic come back when you return

**Send back:** a note, and a screen recording of the moment you return.

### 7. A real phone call interrupts
Ask someone to phone you (a normal call or WhatsApp) while you're in the Manim call.
1. First time: **decline** it.
2. Second time: **answer**, talk for a few seconds, and hang up.

- [ ] After declining: the Manim call carries on normally
- [ ] After answering and hanging up: your Manim mic works again (ask the laptop), or a message tells you what to do
- [ ] The laptop can tell something happened (a muted mic, not silence)

**Send back:** a screen recording on the phone, from just before the call rings to 10 seconds after it ends.

### 8. Keyboard covering the chat
1. Press **Open chat**, then tap the **Message** box so the keyboard comes up.
2. Type a message and send it.
3. On Android, repeat in **More options → Full screen**. (The iPhone doesn't have full screen.)

- [ ] The message box and the send button sit **above** the keyboard, not behind it
- [ ] You can see the last message while typing
- [ ] Closing chat (the **Close panel** X) brings everything back to normal

**Send back:** a screenshot with the keyboard up, on each phone.

### 9. Low battery mode
Turn on **Low Power Mode** (iPhone: Settings → Battery) or **Battery saver** (Android: Settings → Battery). Stay in the call for 5 minutes.
- [ ] Video from the laptop still moves smoothly enough
- [ ] The phone doesn't get uncomfortably hot
- [ ] Battery went from ____ % to ____ % in 5 minutes

**Send back:** the battery numbers, and a note on smoothness and heat.

### 10. The control bar hides and comes back
On each phone:
1. Don't touch anything for 5 seconds. The control bar should slide away.
2. Tap an empty part of the video. It should come back. Tap again to hide it.
3. Open **More options** and wait 10 seconds. The bar should **not** hide while More is open.
4. Open the audio tray and wait 10 seconds. Same: it shouldn't hide.

- [ ] Hides after a few seconds
- [ ] One tap brings it back, first time, every time
- [ ] Stays put while More or the audio tray is open
- [ ] Tapping a video tile doesn't do something unexpected instead

**Send back:** a 20-second screen recording on the Android.

### 11. Scrolling the gallery
You need 5 or more people for this. Open 2–3 extra tabs on the laptop with the invite link, each with a different name. **Close them straight after this check**, because each one uses minutes.
1. On each phone, switch to **Gallery**.
2. Scroll down to the last row.

- [ ] Tiles sit two across on the phone
- [ ] Scrolling is smooth, and the page itself doesn't scroll (only the tiles do)
- [ ] The **last row can be scrolled fully clear of the control bar**. Watch this one on iPhones with no home button.
- [ ] Only one "you" on screen: your own tile in Gallery, no extra floating small video

**Send back:** a screenshot scrolled to the very bottom, on each phone.

### 12. Push notifications on iPhone (Add to Home Screen)
iPhones only allow web notifications for sites added to the Home Screen.
1. In Safari, tap Share → **Add to Home Screen**. Open Manim from the new icon (not from Safari) and sign in.
2. Allow notifications when asked.
3. Lock the iPhone. From the laptop (signed in as a different account that has the iPhone's account as a contact), **ring** it.
4. Separately: join a call with **Waiting room** turned on, as a guest from the Home Screen app. Press **Notify me when I'm let in**, switch to another app, and have the laptop admit you.

- [ ] Incoming-call notification arrives while locked
- [ ] Tapping it opens the right call
- [ ] "You’re in — open Manim to join" notification arrives (Android Chrome too: try the same step there)
- [ ] The Home Screen app looks right (no Safari bars, nothing hidden under the notch)

**Send back:** a screenshot of each notification, and a note if nothing arrived. (If nothing arrives at all, push may not be fully set up on the server yet. That's still useful to know.)

### 13. Weak-connection warning
Turn on the bad network (see "How to make the network bad on purpose") on one phone.
- [ ] Within about 10–20 seconds you see a **"Weak connection"** warning
- [ ] It **never** says "lost" or "disconnected" while the call is still going
- [ ] The warning goes away after you switch the bad network off

**Send back:** a screenshot of the warning, and of anything that said "lost".

### 14. Wifi to mobile data
In a call on a phone with mobile data on, **turn wifi off** (from Control Center or Quick Settings).
- [ ] A **"Reconnecting…"** banner appears (this is the only place "Connection lost" may be said)
- [ ] You're back in the call within ____ seconds, without pressing anything
- [ ] Audio and video both come back. Ask the laptop if they can see you.
- [ ] Turning wifi back on doesn't drop you again

**Send back:** a screen recording from just before turning wifi off to 20 seconds after.

### 15. Joining on a bad network
Keep the bad network on, leave the call, and join again.
- [ ] Join either works, or shows a clear message (e.g. "Couldn't reach the call. Check your connection and join again.")
- [ ] "Connection dropped — trying again…" appears if the first attempt fails, and it retries by itself

**Send back:** the join time (add it to check 1), and a screenshot of any message.

### 16. Laptop extras
- [ ] The arrow next to the mic (**Audio options**) lets you pick both microphone and speaker
- [ ] **Share screen** works, and the phones see the share fill their screen
- [ ] With Chrome DevTools set to **Slow 4G**, the landing page and prejoin still load within about 5 seconds

**Send back:** a note, and a screenshot of any error.

---

## When you're done
1. **Leave** the call on every device (and close the extra laptop tabs).
2. Switch **off** Network Link Conditioner, Low Power Mode and 3G-only mode.
3. Send back this file with the boxes ticked, plus the screenshots and recordings. Add the phone models and system versions (e.g. "iPhone 13, iOS 26" / "Samsung A12, Android 13").
