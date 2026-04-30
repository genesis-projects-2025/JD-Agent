"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionResultListLike = {
  readonly length: number;
  [index: number]: SpeechRecognitionResultLike;
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const AUTO_STOP_AFTER_SILENCE_MS = 1800;
const PLAYBACK_PREF_KEY = "jd-agent-voice-playback";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function mergeDraft(baseDraft: string, transcript: string): string {
  const cleanBase = baseDraft.replace(/\s+$/g, "");
  const cleanTranscript = normalizeWhitespace(transcript);

  if (!cleanBase) return cleanTranscript;
  if (!cleanTranscript) return cleanBase;

  return `${cleanBase} ${cleanTranscript}`.trim();
}

function sanitizeSpeechText(text: string): string {
  return text
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[`*_>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mapSpeechError(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone permission was denied. Allow microphone access and try again.";
    case "audio-capture":
      return "No microphone was detected for live voice input.";
    case "network":
      return "Live speech recognition lost connection. Try again.";
    case "no-speech":
      return "No speech was detected. Try speaking again.";
    default:
      return "Voice input stopped unexpectedly. Please try again.";
  }
}

function pickPreferredVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  const normalizedLang = lang.toLowerCase();
  const sameLocale = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith(normalizedLang),
  );
  const sameLanguage = sameLocale.length
    ? sameLocale
    : voices.filter((voice) =>
        voice.lang.toLowerCase().startsWith(normalizedLang.split("-")[0]),
      );

  if (!sameLanguage.length) return voices[0] ?? null;

  const preferredNames = [
    "aria",
    "samantha",
    "google us english",
    "google uk english female",
    "zira",
    "female",
  ];

  for (const preferredName of preferredNames) {
    const match = sameLanguage.find((voice) =>
      voice.name.toLowerCase().includes(preferredName),
    );
    if (match) return match;
  }

  return sameLanguage[0] ?? null;
}

export function useVoiceConversation({
  draftText,
  onDraftTextChange,
  lang = "en-US",
}: {
  draftText: string;
  onDraftTextChange: (value: string) => void;
  lang?: string;
}) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const baseDraftRef = useRef("");
  const manualStopRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const [supportsSpeechInput, setSupportsSpeechInput] = useState(false);
  const [supportsSpeechOutput, setSupportsSpeechOutput] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [playbackEnabled, setPlaybackEnabledState] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, []);

  const syncDraftWithTranscript = useCallback(
    (interimTranscript: string = "") => {
      const combinedTranscript = normalizeWhitespace(
        `${finalTranscriptRef.current} ${interimTranscript}`,
      );
      onDraftTextChange(mergeDraft(baseDraftRef.current, combinedTranscript));
    },
    [onDraftTextChange],
  );

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    clearSilenceTimer();
    recognitionRef.current?.stop();
  }, [clearSilenceTimer]);

  const scheduleSilenceStop = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      if (recognitionRef.current) {
        manualStopRef.current = true;
        recognitionRef.current.stop();
      }
    }, AUTO_STOP_AFTER_SILENCE_MS);
  }, [clearSilenceTimer]);

  const startListening = useCallback(() => {
    if (typeof window === "undefined") return;

    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      setVoiceError("This browser does not support live voice dictation.");
      return;
    }

    stopSpeaking();
    clearSilenceTimer();

    if (recognitionRef.current) {
      recognitionRef.current.onstart = null;
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.maxAlternatives = 1;

    manualStopRef.current = false;
    baseDraftRef.current = draftText;
    finalTranscriptRef.current = "";
    setVoiceError(null);

    recognition.onstart = () => {
      setIsListening(true);
      scheduleSilenceStop();
    };

    recognition.onresult = (event) => {
      let interimTranscript = "";
      let finalizedChunk = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalizedChunk = `${finalizedChunk} ${transcript}`;
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`;
        }
      }

      if (finalizedChunk.trim()) {
        finalTranscriptRef.current = normalizeWhitespace(
          `${finalTranscriptRef.current} ${finalizedChunk}`,
        );
      }

      syncDraftWithTranscript(interimTranscript);
      scheduleSilenceStop();
    };

    recognition.onerror = (event) => {
      if (manualStopRef.current && event.error === "aborted") return;
      setVoiceError(mapSpeechError(event.error));
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      clearSilenceTimer();
      setIsListening(false);
      syncDraftWithTranscript();
      manualStopRef.current = false;
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceError("Voice input could not start. Please try again.");
    }
  }, [
    clearSilenceTimer,
    draftText,
    lang,
    scheduleSilenceStop,
    stopSpeaking,
    syncDraftWithTranscript,
  ]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      return;
    }
    startListening();
  }, [isListening, startListening, stopListening]);

  const speakText = useCallback(
    (text: string, options?: { force?: boolean }) => {
      if (typeof window === "undefined") return;
      if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance === "undefined") {
        return;
      }

      const cleanText = sanitizeSpeechText(text);
      if (!cleanText) return;
      if (!playbackEnabled && !options?.force) return;

      window.speechSynthesis.cancel();

      const utterance = new window.SpeechSynthesisUtterance(cleanText);
      const voice = pickPreferredVoice(availableVoices, lang);

      utterance.lang = lang;
      utterance.rate = 0.98;
      utterance.pitch = 1.02;
      utterance.volume = 1;
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        setIsSpeaking(false);
      };

      utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        setIsSpeaking(false);
      };

      utteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [availableVoices, lang, playbackEnabled],
  );

  const setPlaybackEnabled = useCallback(
    (enabled: boolean) => {
      setPlaybackEnabledState(enabled);

      if (typeof window !== "undefined") {
        window.localStorage.setItem(PLAYBACK_PREF_KEY, enabled ? "1" : "0");
      }

      if (!enabled) {
        stopSpeaking();
      }
    },
    [stopSpeaking],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    setSupportsSpeechInput(
      Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    );
    setSupportsSpeechOutput(
      Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance),
    );

    const storedPlaybackPreference = window.localStorage.getItem(PLAYBACK_PREF_KEY);
    if (storedPlaybackPreference !== null) {
      setPlaybackEnabledState(storedPlaybackPreference === "1");
    }

    if (!window.speechSynthesis) return;

    const updateVoices = () => {
      setAvailableVoices(window.speechSynthesis?.getVoices() ?? []);
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      if (window.speechSynthesis?.onvoiceschanged === updateVoices) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSilenceTimer();
      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.abort();
        recognitionRef.current = null;
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, [clearSilenceTimer]);

  return {
    isListening,
    isSpeaking,
    playbackEnabled,
    supportsSpeechInput,
    supportsSpeechOutput,
    startListening,
    stopListening,
    stopSpeaking,
    toggleListening,
    speakText,
    setPlaybackEnabled,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
  };
}
