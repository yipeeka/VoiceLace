import { useEffect, useRef, useState } from "react";

export function useAudioPlayer(audioUrl) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    audioRef.current = audioUrl ? new Audio(audioUrl) : null;
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [audioUrl]);

  const toggle = async () => {
    if (!audioRef.current) {
      return;
    }
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    await audioRef.current.play();
    setIsPlaying(true);
  };

  return { isPlaying, toggle };
}
