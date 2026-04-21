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
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);

  useEffect(() => {
    segmentsRef.current = sortedSegments;
    if (currentIdxRef.current >= sortedSegments.length) {
      currentIdxRef.current = -1;
      setCurrentIdx(-1);
      setIsAutoPlay(false);
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
      return false;
    }
    const url = toAbsoluteUrl(queue[idx]?.audio_url);
    if (!url) {
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
      return false;
    }

    audio.pause();
    audio.src = url;
    audio.load();
    const ok = await playAudioWithRetry(audio);
    if (!ok) {
      setIsAutoPlay(false);
      setCurrentIdx(-1);
      currentIdxRef.current = -1;
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
      const next = currentIdxRef.current + 1;
      void playAtIndex(next);
    };
    const onError = () => {
      setIsAutoPlay(false);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  function stop() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    currentIdxRef.current = -1;
    setIsAutoPlay(false);
    setCurrentIdx(-1);
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
    audio.src = url;
    audio.load();
    const ok = await playAudioWithRetry(audio);
    if (!ok) {
      setIsAutoPlay(false);
      return false;
    }

    setCurrentIdx(-1);
    currentIdxRef.current = -1;
    setIsAutoPlay(false);
    return true;
  }

  const currentSegmentId = currentIdx >= 0 ? sortedSegments[currentIdx]?.segment_id || null : null;

  return {
    isAutoPlay,
    currentIdx,
    currentSegmentId,
    playFrom,
    stop,
  };
}
