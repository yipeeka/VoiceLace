import { useEffect, useMemo, useRef, useState } from "react";
import { API_ORIGIN } from "../utils/api";

function toAbsoluteUrl(audioUrl) {
  if (!audioUrl) {
    return "";
  }
  if (audioUrl.startsWith("http://") || audioUrl.startsWith("https://")) {
    return audioUrl;
  }
  return `${API_ORIGIN}${audioUrl}`;
}

export function usePlaybackQueue(segments) {
  const sortedSegments = useMemo(
    () =>
      (segments || [])
        .filter((item) => item && item.audio_url)
        .sort((a, b) => Number(a.index || 0) - Number(b.index || 0)),
    [segments]
  );
  const audioRef = useRef(null);
  const segmentsRef = useRef([]);
  const currentIdxRef = useRef(-1);
  const playbackModeRef = useRef("idle");
  const singleSegmentIdRef = useRef("");
  const singleUrlRef = useRef("");
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [singlePlayingSegmentId, setSinglePlayingSegmentId] = useState("");
  const [isSinglePlaying, setIsSinglePlaying] = useState(false);

  useEffect(() => {
    segmentsRef.current = sortedSegments;
    if (currentIdxRef.current >= sortedSegments.length) {
      currentIdxRef.current = -1;
      playbackModeRef.current = "idle";
      singleSegmentIdRef.current = "";
      singleUrlRef.current = "";
      setCurrentIdx(-1);
      setIsAutoPlay(false);
      setSinglePlayingSegmentId("");
      setIsSinglePlaying(false);
    }
  }, [sortedSegments]);

  useEffect(() => {
    currentIdxRef.current = currentIdx;
  }, [currentIdx]);

  async function playAudioWithRetry(audio) {
    try {
      await audio.play();
      return true;
    } catch {
      if (audio.readyState < 2) {
        await new Promise((resolve) => {
          let settled = false;
          const finalize = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const timer = setTimeout(() => {
            audio.removeEventListener("canplay", onCanPlay);
            finalize();
          }, 1200);
          const onCanPlay = () => {
            clearTimeout(timer);
            finalize();
          };
          audio.addEventListener("canplay", onCanPlay, { once: true });
        });
      }
      try {
        await audio.play();
        return true;
      } catch {
        return false;
      }
    }
  }

  async function playAtIndex(idx) {
    const audio = audioRef.current;
    const queue = segmentsRef.current || [];
    if (!audio || idx < 0 || idx >= queue.length) {
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
      playbackModeRef.current = "idle";
      return false;
    }
    const url = toAbsoluteUrl(queue[idx]?.audio_url);
    if (!url) {
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
      playbackModeRef.current = "idle";
      return false;
    }

    audio.pause();
    playbackModeRef.current = "queue";
    singleSegmentIdRef.current = "";
    singleUrlRef.current = "";
    setSinglePlayingSegmentId("");
    setIsSinglePlaying(false);
    audio.src = url;
    audio.load();
    const ok = await playAudioWithRetry(audio);
    if (!ok) {
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
      playbackModeRef.current = "idle";
      return false;
    }

    setCurrentIdx(idx);
    currentIdxRef.current = idx;
    setIsAutoPlay(true);
    return true;
  }

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onEnded = () => {
      if (playbackModeRef.current !== "queue") {
        playbackModeRef.current = "idle";
        singleSegmentIdRef.current = "";
        singleUrlRef.current = "";
        currentIdxRef.current = -1;
        setCurrentIdx(-1);
        setIsAutoPlay(false);
        setSinglePlayingSegmentId("");
        setIsSinglePlaying(false);
        return;
      }
      const next = currentIdxRef.current + 1;
      void playAtIndex(next);
    };
    const onError = () => {
      playbackModeRef.current = "idle";
      singleSegmentIdRef.current = "";
      singleUrlRef.current = "";
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      setSinglePlayingSegmentId("");
      setIsSinglePlaying(false);
      currentIdxRef.current = -1;
    };
    const onPlay = () => {
      if (playbackModeRef.current === "single") {
        setIsSinglePlaying(true);
      }
    };
    const onPause = () => {
      if (playbackModeRef.current === "single") {
        setIsSinglePlaying(false);
      }
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  function stop() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
    }
    playbackModeRef.current = "idle";
    singleSegmentIdRef.current = "";
    singleUrlRef.current = "";
    currentIdxRef.current = -1;
    setCurrentIdx(-1);
    setIsAutoPlay(false);
    setSinglePlayingSegmentId("");
    setIsSinglePlaying(false);
  }

  async function playSingle(audioUrlHint = "", segmentId = "") {
    const audio = audioRef.current;
    const url = toAbsoluteUrl(audioUrlHint);
    if (!audio || !url) {
      return false;
    }
    const normalizedId = String(segmentId || url);
    if (playbackModeRef.current === "single" && singleSegmentIdRef.current === normalizedId && singleUrlRef.current === url) {
      if (audio.paused) {
        const resumed = await playAudioWithRetry(audio);
        setIsSinglePlaying(resumed);
        return resumed;
      }
      audio.pause();
      setIsSinglePlaying(false);
      return true;
    }
    audio.pause();
    playbackModeRef.current = "single";
    singleSegmentIdRef.current = normalizedId;
    singleUrlRef.current = url;
    currentIdxRef.current = -1;
    setCurrentIdx(-1);
    setIsAutoPlay(false);
    setSinglePlayingSegmentId(normalizedId);
    setIsSinglePlaying(false);
    audio.src = url;
    audio.load();
    const ok = await playAudioWithRetry(audio);
    if (!ok) {
      playbackModeRef.current = "idle";
      singleSegmentIdRef.current = "";
      singleUrlRef.current = "";
      setSinglePlayingSegmentId("");
      setIsSinglePlaying(false);
      return false;
    }
    setIsSinglePlaying(true);
    return true;
  }

  async function playFrom(segmentId, audioUrlHint = "") {
    const audio = audioRef.current;
    if (!audio) {
      return false;
    }
    const queue = segmentsRef.current || [];
    const normalizedId = String(segmentId ?? "");
    const idx = queue.findIndex((item) => String(item?.segment_id ?? "") === normalizedId);

    if (idx >= 0) {
      return playAtIndex(idx);
    }

    const url = toAbsoluteUrl(audioUrlHint);
    if (!url) {
      return false;
    }
    audio.pause();
    playbackModeRef.current = "single";
    singleSegmentIdRef.current = "";
    singleUrlRef.current = url;
    audio.src = url;
    audio.load();
    const ok = await playAudioWithRetry(audio);
    if (!ok) {
      setIsAutoPlay(false);
      playbackModeRef.current = "idle";
      setIsSinglePlaying(false);
      return false;
    }

    setCurrentIdx(-1);
    currentIdxRef.current = -1;
    setIsAutoPlay(false);
    setIsSinglePlaying(false);
    return true;
  }

  const currentSegmentId = currentIdx >= 0 ? sortedSegments[currentIdx]?.segment_id || null : null;

  return {
    isAutoPlay,
    currentIdx,
    currentSegmentId,
    singlePlayingSegmentId,
    isSinglePlaying,
    playFrom,
    playSingle,
    stop,
  };
}
