import { create } from "zustand";

export const useSpeechRecognitionStore = create((set) => ({
  speakerLabels: true,
  transcript: "",
  plainText: "",
  warnings: [],
  error: "",
  backendUsed: "",
  modelFiles: null,
  setSpeakerLabels: (speakerLabels) => set({ speakerLabels: Boolean(speakerLabels) }),
  setTranscript: (transcript) => set({ transcript: String(transcript ?? "") }),
  setPlainText: (plainText) => set({ plainText: String(plainText ?? "") }),
  setWarnings: (warnings) => set({ warnings: Array.isArray(warnings) ? warnings : [] }),
  setError: (error) => set({ error: String(error ?? "") }),
  setBackendUsed: (backendUsed) => set({ backendUsed: String(backendUsed ?? "") }),
  setModelFiles: (modelFiles) => set({ modelFiles: modelFiles ?? null }),
  clearResult: () =>
    set({
      transcript: "",
      plainText: "",
      warnings: [],
      error: "",
      backendUsed: "",
      modelFiles: null,
    }),
}));

