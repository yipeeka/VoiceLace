import { Bot, LoaderCircle, SendHorizontal, Sparkles, Trash2 } from "lucide-react";

import Button from "../ui/Button";
import Select from "../ui/Select";
import { ASSIST_SOURCE_OPTIONS } from "../../utils/musicPageData";

export default function MusicAssistPanel({
  assistInput,
  assistMessages,
  assistSource,
  assistStatus,
  isAssistBusy,
  isAssistChatting,
  isAssistFinalizing,
  isAssistLoading,
  isAssistUnloading,
  isMusicTaskActive,
  onAssistFinalize,
  onAssistLoad,
  onAssistSend,
  onAssistUnload,
  onClearAssistConversation,
  onInputChange,
  onSourceChange,
}) {
  return (
    <div className="musicAssistPanel">
      <div className="sectionHeader musicAssistHeader">
        <h3 className="cardTitle musicAssistTitle">
          <Bot size={16} /> AI 音乐助手（对话模式）
        </h3>
        <div className="secondary">
          {assistStatus?.loaded ? `已加载：${assistStatus?.source || "-"}` : "未加载"}
        </div>
      </div>
      <div className="editorGrid three musicAssistGrid">
        <div className="formGroup">
          <label className="formLabel">LLM 来源</label>
          <Select value={assistSource} onValueChange={onSourceChange} options={ASSIST_SOURCE_OPTIONS} />
        </div>
        <div className="formGroup">
          <label className="formLabel">助手状态</label>
          <div className="secondary musicAssistStatus">
            {assistStatus?.backend || "-"}
          </div>
        </div>
      </div>
      <div className="controlRow musicAssistActions">
        <Button
          variant="secondary"
          disabled={isAssistBusy || isMusicTaskActive}
          onClick={onAssistLoad}
        >
          {isAssistLoading ? <><LoaderCircle size={14} className="spin" /> 加载中...</> : "加载模型"}
        </Button>
        <Button
          variant="ghost"
          disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded}
          onClick={onAssistUnload}
        >
          {isAssistUnloading ? <><LoaderCircle size={14} className="spin" /> 卸载中...</> : "卸载模型"}
        </Button>
        <Button
          variant="primary"
          icon={Sparkles}
          disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || assistMessages.length === 0}
          onClick={onAssistFinalize}
        >
          {isAssistFinalizing ? "填入中..." : "生成并填入"}
        </Button>
        <Button
          variant="ghost"
          icon={Trash2}
          disabled={isAssistBusy || isMusicTaskActive}
          onClick={onClearAssistConversation}
        >
          删除对话
        </Button>
      </div>
      <div className="musicAssistMessages">
        {assistMessages.map((item, index) => (
          <div key={`${item.role}-${index}`} className={`musicAssistMessage ${item.role}`}>
            <div className="musicAssistRole">{item.role === "assistant" ? "助手" : "你"}</div>
            <div className="musicAssistContent">{item.content}</div>
          </div>
        ))}
      </div>
      <div className="musicAssistComposer">
        <textarea
          className="textArea compactArea"
          value={assistInput}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="例如：我要做温暖电影感钢琴配乐，30秒，适合女性旁白开场"
        />
        <Button
          variant="secondary"
          icon={SendHorizontal}
          disabled={isAssistBusy || isMusicTaskActive || !assistStatus?.loaded || !assistInput.trim()}
          onClick={onAssistSend}
        >
          {isAssistChatting ? "发送中..." : "发送"}
        </Button>
      </div>
      {assistStatus?.error ? (
        <div className="errorText">{assistStatus.error}</div>
      ) : null}
    </div>
  );
}
