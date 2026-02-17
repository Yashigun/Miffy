# Voice-to-Symptom Input: Full Pipeline & Architecture

**Feature:** Browser-native voice input for the MediMate medical chatbot
**Scope:** Frontend only — no backend changes required
**Target file:** `MediMateBot/client/src/App.jsx` + `App.css`
**AI model:** Existing Gemini 1.5 Flash via `http://localhost:8080/chat`
**Status:** Hackathon prototype

---

## 1. Problem Statement

Users experiencing medical distress — pain, dizziness, anxiety — often cannot type effectively. Elderly users may find typing difficult. The current chat UI accepts only keyboard input. Voice input removes this barrier, making Miffy genuinely accessible in moments that matter most.

---

## 2. Current System Architecture (As-Is)

```
[User types in <input>]
        |
        v
[input state (useState)]
        |
   Enter key / Send button
        |
        v
[sendMessage()]
   - Validates input (trim check)
   - Clears input field
   - Appends user message to messages[]
   - POST /chat { symptoms: text }
        |
        v
[Express server → Gemini 1.5 Flash]
        |
        v
[{ reply: structured_text }]
        |
        v
[formatBotReply() → renders sections in chat]
```

### Key State Variables (App.jsx)

| Variable      | Type       | Purpose                              |
|---------------|------------|--------------------------------------|
| `input`       | `string`   | Current value of the chat input box  |
| `setInput`    | `setter`   | Updates input field                  |
| `messages`    | `array`    | Full chat history                    |
| `setMessages` | `setter`   | Appends new messages                 |
| `chatEndRef`  | `ref`      | Auto-scroll anchor                   |

### Existing `sendMessage()` Contract

- Reads from `input` state
- Clears `input` immediately on call
- Posts `{ symptoms: input }` to `http://localhost:8080/chat`
- Appends bot reply to `messages[]`
- **No changes needed to this function for voice integration**

---

## 3. Proposed Architecture (Voice Layer)

The voice feature is a **thin input layer** that sits between the microphone and the existing `sendMessage()` function. It replaces keyboard typing with speech, then hands off to the existing pipeline unchanged.

```
[User taps Mic Button]
        |
        v
[VoiceController — new module]
   - Checks browser support (SpeechRecognition API)
   - Requests microphone permission
   - Transitions UI to LISTENING state
        |
        v
[SpeechRecognition instance]
   - interim_results: true  (live transcription)
   - lang: "en-US"
   - continuous: false       (stops after pause)
        |
    onresult event
        |
        v
[Live Transcript Handler]
   - Reads interim transcript
   - Calls setInput(interimText)  ← patches into existing input state
   - User sees text appear in real-time in chat input box
        |
    onend event (speech pause / user stops)
        |
        v
[Final Transcript Handler]
   - Reads final transcript
   - Calls setInput(finalText)
   - Transitions UI to PROCESSING state
   - Calls sendMessage()  ← existing function, zero changes
        |
        v
[Existing Pipeline resumes normally]
   - POST /chat { symptoms: finalText }
   - Gemini responds
   - formatBotReply() renders sections
```

---

## 4. Browser API: SpeechRecognition

### What it is

The Web Speech API's `SpeechRecognition` interface is a native browser capability — no libraries, no installs, no API keys. It sends audio to the browser vendor's cloud (Google, in Chrome's case) and returns transcribed text as JavaScript events.

### Key properties used

| Property             | Value   | Why                                                      |
|----------------------|---------|----------------------------------------------------------|
| `continuous`         | `false` | Stops automatically after a pause. Simpler for patients. |
| `interimResults`     | `true`  | Shows live text as user speaks — critical UX.            |
| `lang`               | `"en-US"` | Default. Can be made dynamic for multilingual support. |
| `maxAlternatives`    | `1`     | Only need the top transcript result.                     |

### Key events consumed

| Event        | When it fires                              | What we do                                      |
|--------------|--------------------------------------------|-------------------------------------------------|
| `onstart`    | Mic opens, recognition begins              | Transition UI to LISTENING state                |
| `onresult`   | Speech detected (interim or final)         | Update `input` state with current transcript    |
| `onerror`    | Permission denied / no speech / network    | Show error state, reset UI                      |
| `onend`      | Recognition session closes (auto or manual)| Finalize transcript, call `sendMessage()`       |

### Browser support note

SpeechRecognition is available as `window.SpeechRecognition` (standard) or `window.webkitSpeechRecognition` (Chrome). For the demo, Chrome is the target and fully supports this API. Firefox and Safari have limited or no support — handled via graceful fallback.

---

## 5. New State Variables Required

These additions go into `App.jsx` alongside existing state:

| Variable           | Type      | Purpose                                                   |
|--------------------|-----------|-----------------------------------------------------------|
| `isListening`      | `boolean` | Whether the mic is currently active                       |
| `voiceError`       | `string`  | Error message to display (null if no error)               |
| `voiceSupported`   | `boolean` | Whether the browser supports SpeechRecognition            |
| `recognitionRef`   | `ref`     | Holds the SpeechRecognition instance across renders       |

---

## 6. Voice Controller: Responsibilities

This is the logical module (not a separate file — lives in `App.jsx`) that owns the voice lifecycle.

### `initVoice()`
- Called once on component mount (useEffect)
- Detects browser support: checks `window.SpeechRecognition || window.webkitSpeechRecognition`
- Sets `voiceSupported` state
- Creates and configures the SpeechRecognition instance
- Attaches all event handlers (`onresult`, `onerror`, `onend`)
- Stores instance in `recognitionRef`

### `startListening()`
- Triggered by mic button click
- Guards: if `isListening` is already true, do nothing (prevents double-start crash)
- Clears current `input` state (fresh start for voice)
- Calls `recognitionRef.current.start()`
- Sets `isListening = true`, clears `voiceError`

### `stopListening()`
- Can be triggered by: user clicking mic again, `onend` event firing, error occurring
- Calls `recognitionRef.current.stop()`
- Sets `isListening = false`

### `handleResult(event)`
- Attached to `onresult`
- Iterates `event.results` to build the current transcript string
- Distinguishes interim vs final results using `event.results[i].isFinal`
- Always calls `setInput(transcript)` — interim or final
- When a final result arrives: calls `sendMessage()` after a short tick (16ms) to ensure state has flushed

### `handleError(event)`
- Attached to `onerror`
- Maps error codes to human-readable messages:
  - `not-allowed` → "Microphone access denied. Please allow mic in browser settings."
  - `no-speech` → "No speech detected. Please try again."
  - `network` → "Voice recognition is unavailable. Please type your symptoms."
  - `audio-capture` → "No microphone found. Please check your device."
- Sets `voiceError` state (displayed below input bar)
- Calls `stopListening()`

---

## 7. UI State Machine

The mic button and surrounding UI cycle through four distinct states:

```
         ┌──────────────────────────────────────────────┐
         │                                              │
    [IDLE] ──── click mic ────> [LISTENING]             │
         │                           |                  │
         │                     user pauses              │
         │                     or clicks mic            │
         │                           |                  │
         │                           v                  │
         │                    [PROCESSING]              │
         │                           |                  │
         │                     sendMessage()            │
         │                     completes                │
         │                           |                  │
         └─────────────────── [IDLE] ◄─────────────────┘

    [ERROR] can be reached from [LISTENING] via onerror
    [ERROR] auto-resets to [IDLE] after user dismisses or retries
```

### State → UI Mapping

| State          | Mic Button Appearance           | Input Box Behavior              | Status Text             |
|----------------|---------------------------------|---------------------------------|-------------------------|
| `IDLE`         | Mic icon, default color         | Empty, ready for input          | None                    |
| `LISTENING`    | Pulsing animation, active color | Shows live transcript (editable)| "Listening..."          |
| `PROCESSING`   | Spinner or disabled             | Shows final text (read-only)    | "Sending..."            |
| `ERROR`        | Error color, exclamation icon   | Unchanged                       | Error message text      |
| `UNSUPPORTED`  | Mic hidden or grayed out        | Normal text input               | Fallback tooltip        |

---

## 8. Detailed Data Flow

### Happy Path (voice input → AI response)

```
Step 1: Component mounts
        → initVoice() runs
        → SpeechRecognition instance created
        → voiceSupported = true

Step 2: User clicks mic button
        → startListening() called
        → isListening = true
        → UI shows pulsing mic + "Listening..."
        → input state cleared

Step 3: User says "I have chest pain and dizziness"
        → onresult fires repeatedly with interim results
        → Each interim result: setInput("I have chest pain...")
        → User sees text appear live in input box

Step 4: User pauses speaking (natural sentence end)
        → SpeechRecognition detects silence
        → onresult fires with isFinal = true
        → Final transcript set: setInput("I have chest pain and dizziness")
        → onend fires
        → stopListening() called (isListening = false)
        → sendMessage() called

Step 5: sendMessage() executes (unchanged)
        → Reads from input state
        → Appends user message to chat
        → POST { symptoms: "I have chest pain and dizziness" }
        → Clears input
        → Waits for Gemini response

Step 6: Gemini returns structured reply
        → formatBotReply() parses and renders
        → Chat scrolls to bottom via chatEndRef
        → UI returns to IDLE
```

### Error Path (permission denied)

```
User clicks mic
→ Browser prompts for microphone permission
→ User clicks "Block"
→ onerror fires: event.error = "not-allowed"
→ handleError() maps to message
→ voiceError = "Microphone access denied. Please allow mic in browser settings."
→ isListening = false
→ Error message appears below input bar
→ User can still type manually
```

### Unsupported Browser Path

```
Component mounts
→ initVoice() checks window.SpeechRecognition
→ undefined (Firefox, Safari without flag)
→ voiceSupported = false
→ Mic button hidden or replaced with tooltip
→ No mic-related code runs
→ Text input works normally
→ Fallback tooltip: "Voice input not supported in this browser. Use Chrome for voice."
```

---

## 9. Integration with Existing App.jsx

### What changes in App.jsx

1. **Three new state variables** added alongside existing `input`, `messages`
2. **One new ref** (`recognitionRef`) added alongside `chatEndRef`
3. **`useEffect` expanded** — existing scroll effect unchanged; new `initVoice()` call added in same or separate `useEffect`
4. **`sendMessage()` — zero changes** — voice simply calls it the same way the Send button does
5. **JSX input bar** — mic button added as a sibling to the existing `<input>` and `<button>Send</button>`
6. **Error display** — one new `<p>` element conditionally rendered below the input bar

### What does NOT change

- `sendMessage()` function — completely untouched
- `formatBotReply()` function — completely untouched
- Message rendering logic — completely untouched
- Backend server — zero changes
- Gemini integration — zero changes
- All existing CSS classes — untouched

---

## 10. Component Anatomy (Post-Integration)

```
<App>
  ├── <FloatingShape> (unchanged)
  ├── <div.chat-container>
  │   ├── <header> (unchanged)
  │   ├── <div.chat-box>  (unchanged)
  │   │   └── messages.map → <div.message> (unchanged)
  │   └── <div.input-bar>    ← MODIFIED
  │       ├── <input>        ← unchanged element, now also updated by voice
  │       ├── <button.mic-btn>   ← NEW
  │       │   └── mic icon / pulsing animation
  │       └── <button>Send</button>  ← unchanged
  └── <p.voice-error>   ← NEW (conditional)
```

---

## 11. CSS Architecture for Voice States

### New classes needed

| Class                  | Purpose                                                    |
|------------------------|------------------------------------------------------------|
| `.mic-btn`             | Base mic button styles — size, shape, color                |
| `.mic-btn.listening`   | Active state — color change, applies pulse animation       |
| `.mic-btn.error`       | Error state — red/warning color                            |
| `.mic-btn:disabled`    | Processing state — reduced opacity, no pointer events      |
| `@keyframes pulse`     | Radial pulse animation emanating from mic button           |
| `.voice-status`        | Small text label below/above input showing state text      |
| `.voice-error`         | Error message styling — warm amber, readable font size     |

### Animation design intent

The pulse animation should feel **calm, not alarming** — it is displayed during a medical interaction. A slow, gentle radial ring (not a flashing red indicator) communicates "I'm listening" without inducing stress. 2-second cycle, low opacity rings, teal color matching the existing design system (#02415a).

---

## 12. Error Handling Strategy

| Error Code       | User-Visible Message                                                  | Recovery Action                    |
|------------------|-----------------------------------------------------------------------|------------------------------------|
| `not-allowed`    | "Microphone access denied. Please allow mic in browser settings."     | User must change browser permission |
| `no-speech`      | "No speech detected. Please try again or type your symptoms."         | Mic resets to IDLE, user retries   |
| `network`        | "Voice service unavailable. Please type your symptoms."               | Falls back to text input           |
| `audio-capture`  | "No microphone found. Please check your device."                      | Mic hidden, text input active      |
| `aborted`        | Silent recovery — recognition stopped intentionally                   | Reset to IDLE                      |
| Unknown error    | "Voice input error. Please type your symptoms."                       | Reset to IDLE                      |

All errors preserve the chat input box and text entry — voice failure never blocks the user from seeking help.

---

## 13. Accessibility Considerations

### Mic Button
- Minimum tap target: 44x44px (WCAG 2.1 AA)
- `aria-label`: changes dynamically — "Start voice input" / "Stop listening"
- `aria-pressed`: reflects `isListening` boolean
- `role="button"` explicitly set

### Status Text
- `aria-live="polite"` on the status label — screen readers announce state changes without interrupting
- "Listening..." and error messages are announced automatically

### Input Box Behavior
- Voice-transcribed text appears in the same visible, editable `<input>` as typed text
- User can **edit the transcript before it sends** — no invisible or locked fields
- This is critical for medical accuracy — a misheard word could change clinical meaning

### Color
- Listening state uses existing brand teal (#02415a) for the pulse, not a jarring new color
- Error state uses amber/orange — universally understood as "caution" without being emergency red

---

## 14. Edge Cases & Guards

| Scenario                                    | Handling                                                                 |
|---------------------------------------------|--------------------------------------------------------------------------|
| User clicks mic twice rapidly               | Guard in `startListening()` — does nothing if `isListening` is true      |
| User speaks but input is just whitespace    | `sendMessage()` already guards: `if (!input.trim()) return`              |
| Recognition ends with empty transcript      | `onend` fires, but `sendMessage()` no-ops on empty string                |
| User edits transcript manually before send  | Because text is in the normal `input` state, edits work naturally        |
| Network drops mid-recognition               | `onerror` fires with `network` code — handled above                      |
| Multiple rapid mic toggles                  | `recognitionRef` ensures only one instance exists at a time              |
| Component unmounts while listening          | `useEffect` cleanup calls `recognition.abort()` to prevent memory leaks  |
| Mobile browser                              | Excluded from primary demo — Web Speech API unreliable on mobile         |

---

## 15. File Change Summary

| File                                   | Change Type | What changes                                          |
|----------------------------------------|-------------|-------------------------------------------------------|
| `MediMateBot/client/src/App.jsx`       | Modified    | 3 new state vars, 1 new ref, voice logic functions, mic button in JSX |
| `MediMateBot/client/src/App.css`       | Modified    | `.mic-btn`, `@keyframes pulse`, `.voice-status`, `.voice-error` |
| All other files                        | Unchanged   | No modifications anywhere else                        |

---

## 16. Demo Script (Hackathon Pitch)

This is the exact sequence to run during live demo for maximum impact:

```
1. Open MediMate Bot in Chrome (https://localhost:5173 or whatever Vite port)

2. Say to judges:
   "Most people who need medical help urgently can't type. Watch this."

3. Click the mic button (show the pulse animation beginning)

4. Say clearly: "I have severe chest pain and I can't breathe properly."

5. Watch text appear live in the input box as you speak.

6. Pause. Recognition ends. Text sends automatically.

7. Point to Gemini's structured response appearing:
   — Severity
   — Immediate Need for Attention
   — See a Doctor If
   — Next Steps

8. Say:
   "From voice to structured medical guidance in under 5 seconds.
    No typing. No barriers. Just speak."
```

This takes under 30 seconds and demonstrates the full voice → AI → structured output pipeline visually.

---

## 17. Future Enhancements (Post-Hackathon)

These are out of scope now but worth flagging in the pitch as the roadmap:

| Enhancement                    | Value                                                          |
|--------------------------------|----------------------------------------------------------------|
| Language auto-detection        | Serve multilingual users — detect browser language, set `recognition.lang` |
| Continuous listening mode      | Long symptom descriptions spanning multiple sentences          |
| Confidence threshold filter    | Reject low-confidence transcripts to reduce medical misreads   |
| Whisper API fallback           | OpenAI Whisper for browsers where SpeechRecognition fails      |
| Voice output (TTS)             | Read Gemini's response aloud for visually impaired users       |
| Push-to-talk vs always-on      | User preference toggle                                         |

---

## Summary

The Voice-to-Symptom feature is a **frontend-only, zero-backend-change** enhancement. It slots into the existing React state model by writing to the same `input` state that the keyboard does, then calling the same `sendMessage()` the Send button calls. The only new pieces are:

- A `SpeechRecognition` instance managed via a ref
- Three new state variables for UI mode management
- A mic button with a CSS pulse animation
- Error message display for graceful degradation

The result: a user in distress speaks three words, and 5 seconds later receives structured AI medical guidance — with no typing, no friction, no barrier.
