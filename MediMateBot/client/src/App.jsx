import { useState, useRef, useEffect } from "react";
import "./App.css";
import { bot_icon } from "./assets/assets";
import FloatingShape from "./FloatingShape";

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);

  // Voice state
  const [isListening, setIsListening] = useState(false);   // mic is recording
  const [isTranscribing, setIsTranscribing] = useState(false); // waiting for Gemini
  const [voiceError, setVoiceError] = useState(null);
  const [voiceSupported, setVoiceSupported] = useState(false);

  const chatEndRef = useRef(null);
  const mediaRecorderRef = useRef(null);  // MediaRecorder instance
  const audioChunksRef = useRef([]);      // raw audio chunks collected while recording

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Check MediaRecorder support on mount
  useEffect(() => {
    setVoiceSupported(!!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder));
  }, []);

  // sendMessage accepts an optional textOverride (used by voice path)
  // When called from keyboard/button, it reads from input state as before
  const sendMessage = async (textOverride) => {
    const text = typeof textOverride === "string" ? textOverride : input;
    if (!text.trim()) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);

    try {
      const res = await fetch("http://localhost:8080/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptoms: text }),
      });
      const data = await res.json();
      setMessages((m) => [
        ...m,
        { role: "bot", text: data.reply || "No reply from server." },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "bot", text: "Error connecting to server." },
      ]);
    }
  };

  // Record audio with MediaRecorder, then transcribe via Gemini on the backend.
  // This avoids Chrome's SpeechRecognition which requires speech.googleapis.com.
  const startListening = async () => {
    if (isListening || isTranscribing) return;
    setVoiceError(null);
    audioChunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      // Collect audio data as it comes in
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      // When recording stops: convert blob → base64 → POST /transcribe → sendMessage
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); // release mic immediately

        // Use the actual MIME type the browser chose (e.g. "audio/webm;codecs=opus")
        const actualMimeType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: actualMimeType });
        audioChunksRef.current = [];

        if (blob.size < 500) {
          setVoiceError("No audio captured. Please try again.");
          return;
        }

        setIsTranscribing(true);

        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = reader.result.split(",")[1]; // strip the data-URL prefix
          try {
            const res = await fetch("http://localhost:8080/transcribe", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ audio: base64, mimeType: actualMimeType }),
            });
            const data = await res.json();
            setIsTranscribing(false);
            if (data.transcript) {
              sendMessage(data.transcript); // hand off to existing pipeline
            } else {
              // data.error is the real message from the backend
              setVoiceError(data.error || "Couldn't understand audio. Please try again or type.");
            }
          } catch {
            setIsTranscribing(false);
            setVoiceError("Transcription failed. Please type your symptoms.");
          }
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start();
      setIsListening(true);
    } catch (e) {
      if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
        setVoiceError("Microphone access denied. Please allow mic in your browser settings.");
      } else {
        setVoiceError("Could not access microphone. Please check your device.");
      }
    }
  };

  const stopListening = () => {
    if (!mediaRecorderRef.current || !isListening) return;
    setIsListening(false);
    mediaRecorderRef.current.stop(); // triggers onstop → transcription
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  function formatBotReply(text) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const sections = {};
    let currentKey = null;

    const matchers = {
      Severity: /severity\s*:/i,
      "Immediate Need for Attention": /immediate\s+need\s+for\s+attention\s*:/i,
      "See a Doctor If": /(see|seek).*(doctor|medical)/i,
      "Next Steps": /next\s+steps\s*:/i,
      "Possible Conditions": /possible\s+conditions\s*:/i,
      Disclaimer: /disclaimer\s*:/i,
    };

    lines.forEach((line) => {
      for (let key in matchers) {
        if (matchers[key].test(line)) {
          currentKey = key;
          if (
            ["See a Doctor If", "Next Steps", "Possible Conditions"].includes(
              key
            )
          ) {
            sections[key] = [];
          } else {
            sections[key] = line.replace(matchers[key], "").trim();
          }
          return;
        }
      }

      if (line.startsWith("-") && currentKey && Array.isArray(sections[currentKey])) {
        sections[currentKey].push(line.replace(/^-/, "").trim());
      } else if (
        /^[-•*0-9]+\./.test(line) &&
        currentKey &&
        Array.isArray(sections[currentKey])
      ) {
        sections[currentKey].push(line.replace(/^[-•*0-9.]+\s*/, "").trim());
      }
    });

    return (
      <div className="bot-reply" style={{ lineHeight: "1.6" }}>
        {sections["Severity"] && (
          <p>
            <strong>Severity:</strong> {sections["Severity"]}
          </p>
        )}
        {sections["Immediate Need for Attention"] && (
          <p>
            <strong>Immediate Need for Attention:</strong>{" "}
            {sections["Immediate Need for Attention"]}
          </p>
        )}
        {sections["See a Doctor If"]?.length > 0 && (
          <div>
            <strong>See a Doctor If:</strong>
            <ul>
              {sections["See a Doctor If"].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {sections["Next Steps"]?.length > 0 && (
          <div>
            <strong>Next Steps:</strong>
            <ul>
              {sections["Next Steps"].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {sections["Possible Conditions"]?.length > 0 && (
          <div>
            <strong>Possible Conditions:</strong>
            <ul>
              {sections["Possible Conditions"].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {sections["Disclaimer"] && <p><em>{sections["Disclaimer"]}</em></p>}
      </div>
    );
  }

  return (
    <div className="app">
      {/* Floating shapes */}
      <FloatingShape color="#02415a" size={250} top="10%" left="15%" delay={0} />
      <FloatingShape color="#036280" size={300} top="40%" left="70%" delay={3} />
      <FloatingShape color="#012f45" size={200} top="65%" left="25%" delay={5} />
      <FloatingShape color="#043d5f" size={150} top="75%" left="50%" delay={2} />

      {/* Header */}
      <div className="header">MediMate Bot</div>

      {/* Chat window */}
      <div className="chat-box">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message ${msg.role}`}
            style={{
              animation: "fadeIn 0.3s forwards",
              animationDelay: `${i * 0.1}s`,
            }}
          >
            {msg.role === "bot" && (
              <img src={bot_icon} alt="bot" className="bot-avatar" />
            )}
            <div className="message-bubble">
              {msg.role === "bot" ? formatBotReply(msg.text) : msg.text}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input bar */}
      <div className="input-bar">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder={
            isTranscribing
              ? "Transcribing..."
              : isListening
              ? "Recording... click mic to stop"
              : "Describe your symptoms..."
          }
          disabled={isTranscribing}
        />

        {/* Mic button — only rendered if MediaRecorder is supported */}
        {voiceSupported && (
          <button
            className={`mic-btn ${isListening ? "listening" : ""} ${isTranscribing ? "transcribing" : ""}`}
            onClick={toggleListening}
            disabled={isTranscribing}
            aria-label={isListening ? "Stop recording" : "Start voice input"}
            aria-pressed={isListening}
            title={isTranscribing ? "Transcribing..." : isListening ? "Stop recording" : "Speak your symptoms"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              width="20"
              height="20"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
          </button>
        )}

        <button onClick={sendMessage} disabled={isTranscribing}>Send</button>
      </div>

      {/* Status messages */}
      {isListening && (
        <p className="voice-status" aria-live="polite">
          Recording... click the mic again to stop
        </p>
      )}
      {isTranscribing && (
        <p className="voice-status" aria-live="polite">
          Transcribing with Gemini...
        </p>
      )}

      {/* Voice error message */}
      {voiceError && (
        <p className="voice-error" role="alert">
          {voiceError}
        </p>
      )}
    </div>
  );
}

export default App;
