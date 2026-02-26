## Inspiration

Everyone’s had the same reaction mid-movie or mid-video: **“bro why would you do that?”** or **“wait… what did they just say?”** — you’re fully locked in, and then the platform does the worst possible thing: a hard cut to an ad.

I wanted to build something that treats immersion like a fragile thread — not something you slash every few minutes.

So I asked a slightly cursed question:

> **What if ads didn’t interrupt the story… but briefly happened *inside* the story — and then reality snapped back like nothing happened?**

That became **Breakout**: a video player where the timeline can “warp” for 15 seconds, inject an **in-scene, skippable, AI-generated ad moment**, and seamlessly rejoin the original video.

---

## What it does

**Breakout** is a native web video player with **in-scene ad insertion**:

- Plays a normal video (I demo with **Tears of Steel**, open-licensed)
- At specific timeline points, Breakout triggers a **15-second “Ad Possession” moment**
  - The character briefly “hijacks” into a subtle product beat (ex: cologne spray / phone glance)
  - Then the video returns to the exact timeline like nothing happened
- A **Skip Ad** button instantly jumps back to the original timeline
- A **Learn More** button opens a clean product page overlay (without leaving the video)
- At the end, a **micro-survey** collects preferences to personalize the type of generated ads shown next time

The goal isn’t louder ads. It’s the opposite:

> **Ads that feel like they belong — and disappear without breaking immersion.**

---

## Why this is different

Traditional ads are external content stitched between scenes.

Breakout flips that:

- The ad moment is generated to **match the existing shot** (framing, lighting, continuity)
- It’s **short, subtle, and skippable**
- It’s presented as an *in-universe beat*, not a cutaway

The result is a weirdly satisfying effect: I can literally **seek to ad moments** on the timeline and show how clean the rejoin is — because the system is designed around continuity, not interruption.

---

## Gemini Integration (what I used + why it’s central)

Breakout uses the Gemini 3 family as the creative + control layer that makes these inserts coherent:

- **Gemini 3** generates structured **ad plans** from a product pack (brand, vibe, action choreography, tagline) and scene constraints (camera locked, preserve identity, match lighting).
- **Veo (Gemini video generation)** generates the **15-second in-scene ad segment**, preserving the original scene while injecting the product action.
- **Gemini 3** also generates the **Learn More** page copy (short description + key benefits), and adapts it to the viewer’s end-of-video micro-survey preferences.

Gemini isn’t just “in the app” — it’s what allows Breakout to produce **repeatable, scene-consistent, skippable ad moments**.

---

## How I built it

### 1) A custom player with timeline “warp points”
I built a web player that supports ad insertion windows:
- Each video has one or more insertion windows: `t0 → t0+15s`
- When playback crosses `t0`, Breakout swaps into the generated ad segment
- When the ad segment ends, it swaps back and resumes at `t1`

This makes “seek to ads” real and keeps the demo reliable.

### 2) “Playlist stitching” (fast + reliable)
Instead of re-encoding an entire movie, I stitch during playback:

1. Play the original video until `t0`
2. Swap the source to the generated 15-second clip
3. On end (or Skip Ad), swap back and seek to `t1`

This avoids heavy processing and keeps everything responsive.

### 3) Veo generation: the “Ad Possession” segment
For each insertion window I generate a 15-second clip where the scene is preserved but the character performs a subtle product action.

I focused on keeping choreography small (hands/torso/head) for realism:
- **Cologne:** quick spray + subtle confidence shift  
- **Phone:** quick unlock + swipe + soft screen glow reflection

### 4) Learn More overlay
During the ad moment, the viewer can tap **Learn More**:
- Opens an in-app product page overlay (no forced navigation away)
- Shows brand story, key benefits, and a CTA

### 5) Personalization micro-survey
At the end, a 2-second survey asks what the viewer actually wants to see (tech, fragrance, snacks, etc.). That preference becomes a signal for **what types of generated inserts appear next**.

---

## Architecture (high level)

**Frontend (Breakout Web App)**
- Custom player UI (timeline markers, seek-to-ad, skip, learn more, survey)

**Backend (Generation + caching)**
- Input: `(videoId, t0, duration, productPack, userPrefs)`
- Gemini 3: produces an “ad plan” + prompt structure
- Veo: generates the 15-second insert clip
- Cache: reuses clips for the same `(videoId, window, product)` combination

---

## Challenges I faced

### Seamlessness is hard
If the generated clip doesn’t match framing/lighting/identity, the illusion breaks instantly. I had to design prompts and choreography that:
- keep the camera locked
- keep motion minimal
- preserve face/background
- avoid “model drift” over 15 seconds

### Making it feel skippable and ethical
I wanted something people could actually imagine using, so:
- **Skip Ad** is always visible
- the insert is clearly a sponsored moment
- I used open-licensed / demo-safe content for the prototype

### Keeping the demo fast
Generating video live can be slow, so caching and repeatability mattered:
- I pre-generated key segments for the demo
- I reused the same insert clip for the same window/product combo

---

## What I learned

- “Ad tech” is usually about targeting — but the real user pain is **immersion loss**.
- The hardest part isn’t generation. It’s **continuity**.
- If you treat ads as *timeline events* instead of *interruptions*, you can build a totally different viewing experience.

---

## What’s next

- Auto-select insertion windows (find stable shots automatically)
- More subtle product behaviors (prop interactions, ambient UI moments)
- Better personalization (survey → preference profile → ad style tuning)
- Creator controls (brands + creators define what’s allowed in-scene)

---

**Breakout** is my bet that the future of ads isn’t louder — it’s **seamless, skippable, and in-universe**.
