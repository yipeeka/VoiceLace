import { create } from "zustand";

export const useSpeechRecognitionStore = create((set) => ({
  speakerLabels: false,
  transcript: "",
  plainText: "",
  warnings: [],
  error: "",
  backendUsed: "",
  modelFiles: null,
  translationSource: "secondary_local",
  translationMode: "polish_only",
  translationTargetLanguage: "中文",
  translationResult: "",
  translationError: "",
  translationEngineStatus: {
    loaded: false,
    source: "",
    backend: "unloaded",
    model_name: "",
    error: "",
  },
  setSpeakerLabels: (speakerLabels) => set({ speakerLabels: Boolean(speakerLabels) }),
  setTranscript: (transcript) => set({ transcript: String(transcript ?? "") }),
  setPlainText: (plainText) => set({ plainText: String(plainText ?? "") }),
  setWarnings: (warnings) => set({ warnings: Array.isArray(warnings) ? warnings : [] }),
  setError: (error) => set({ error: String(error ?? "") }),
  setBackendUsed: (backendUsed) => set({ backendUsed: String(backendUsed ?? "") }),
  setModelFiles: (modelFiles) => set({ modelFiles: modelFiles ?? null }),
  setTranslationSource: (translationSource) => set({ translationSource: String(translationSource ?? "secondary_local") }),
  setTranslationMode: (translationMode) => set({ translationMode: String(translationMode ?? "polish_only") }),
  setTranslationTargetLanguage: (translationTargetLanguage) => set({ translationTargetLanguage: String(translationTargetLanguage ?? "中文") }),
  setTranslationResult: (translationResult) => set({ translationResult: String(translationResult ?? "") }),
  setTranslationError: (translationError) => set({ translationError: String(translationError ?? "") }),
  setTranslationEngineStatus: (translationEngineStatus) =>
    set({
      translationEngineStatus: {
        loaded: Boolean(translationEngineStatus?.loaded),
        source: String(translationEngineStatus?.source ?? ""),
        backend: String(translationEngineStatus?.backend ?? "unloaded"),
        model_name: String(translationEngineStatus?.model_name ?? ""),
        error: String(translationEngineStatus?.error ?? ""),
      },
    }),
  clearTranslationResult: () =>
    set({
      translationResult: "",
      translationError: "",
    }),
  clearResult: () =>
    set({
      transcript: "",
      plainText: "",
      warnings: [],
      error: "",
      backendUsed: "",
      modelFiles: null,
      translationResult: "",
      translationError: "",
    }),
}));
