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
  const [isAutoPlay, setIsAutoPlay] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onEnded = () => {
      setCurrentIdx((prev) => {
        const next = prev + 1;
        if (next < sortedSegments.length) {
          const nextUrl = toAbsoluteUrl(sortedSegments[next]?.audio_url);
          if (nextUrl) {
            audio.src = nextUrl;
            void audio.play().catch(() => undefined);
            return next;
          }
        }
        setIsAutoPlay(false);
        return -1;
      });
    };
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.pause();
      audioRef.current = null;
    };
  }, [sortedSegments]);

  function stop() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.src = "";
    }
    setIsAutoPlay(false);
    setCurrentIdx(-1);
  }

  async function playFrom(segmentId) {
    const audio = audioRef.current;
    if (!audio) {
      return false;
    }
    const idx = sortedSegments.findIndex((item) => item.segment_id === segmentId);
    if (idx < 0) {
      return false;
    }
    const url = toAbsoluteUrl(sortedSegments[idx].audio_url);
    if (!url) {
      return false;
    }
    audio.pause();
    audio.src = url;
    setCurrentIdx(idx);
    setIsAutoPlay(true);
    try {
      await audio.play();
      return true;
    } catch {
      setIsAutoPlay(false);
      return false;
    }
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
