import AudioPlayer from "../shared/AudioPlayer";
import { buildReferenceAudioUrl } from "../../utils/voiceConfigData";

export default function ReferenceAudioPlayer({ audioPath }) {
  const audioUrl = buildReferenceAudioUrl(audioPath);
  if (!audioUrl) return null;
  return <AudioPlayer audioUrl={audioUrl} height={44} compact />;
}
