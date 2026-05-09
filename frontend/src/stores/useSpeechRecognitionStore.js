import { create } from "zustand";

export const useSpeechRecognitionStore = create((set) => ({
  speakerLabels: false,
  transcript: "",
  plainText: "",
  warnings: [],
  alignments: [],
  speakerMap: {},
  showTimeline: false,
  error: "",
  backendUsed: "",
  modelFiles: null,
  translationSource: "secondary_local",
  translationMode: "polish_only",
  translationTargetLanguage: "中文",
  asrBackend: "whisper",
  asrEnableTimestamps: false,
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
  setAlignments: (alignments) => set({ alignments: Array.isArray(alignments) ? alignments : [] }),
  setSpeakerMap: (speakerMap) => set({ speakerMap: speakerMap && typeof speakerMap === "object" ? { ...speakerMap } : {} }),
  setShowTimeline: (showTimeline) => set({ showTimeline: Boolean(showTimeline) }),
  updateSpeakerMapEntry: (source, target) =>
    set((state) => ({
      speakerMap: {
        ...(state.speakerMap || {}),
        [String(source || "")]: String(target || ""),
      },
    })),
  setError: (error) => set({ error: String(error ?? "") }),
  setBackendUsed: (backendUsed) => set({ backendUsed: String(backendUsed ?? "") }),
  setModelFiles: (modelFiles) => set({ modelFiles: modelFiles ?? null }),
  setTranslationSource: (translationSource) => set({ translationSource: String(translationSource ?? "secondary_local") }),
  setTranslationMode: (translationMode) => set({ translationMode: String(translationMode ?? "polish_only") }),
  setTranslationTargetLanguage: (translationTargetLanguage) => set({ translationTargetLanguage: String(translationTargetLanguage ?? "中文") }),
  setAsrBackend: (asrBackend) => {
    const val = String(asrBackend ?? "whisper").trim().toLowerCase();
    set({ asrBackend: val === "qwen3_crispasr" ? "qwen3_crispasr" : "whisper" });
  },
  setAsrEnableTimestamps: (asrEnableTimestamps) => set({ asrEnableTimestamps: Boolean(asrEnableTimestamps) }),
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
      alignments: [],
      speakerMap: {},
      showTimeline: false,
      error: "",
      backendUsed: "",
      modelFiles: null,
      translationResult: "",
      translationError: "",
      asrEnableTimestamps: false,
    }),
}));
