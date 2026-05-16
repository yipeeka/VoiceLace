import { FolderPlus, Languages } from "lucide-react";

import Button from "../ui/Button";

export default function TranslationPolishPanel({
  canBuildDubbingProject,
  canInsertTranslation,
  clearTranslationResult,
  dubbingTask,
  isBuildingDubbingProject,
  isCreatingProject,
  isLoadingTranslationEngine,
  isQwen3Backend,
  isTranslating,
  isTranslationEngineLoaded,
  onAbortTranslate,
  onAppendTranslationToText,
  onCreateDubbingProject,
  onLoadTranslationEngine,
  onReplaceTranslationToText,
  onTranslatePolish,
  onUnloadTranslationEngine,
  setTranslationMode,
  setTranslationResult,
  setTranslationSource,
  setTranslationTargetLanguage,
  translationEngineStatus,
  translationError,
  translationMode,
  translationResult,
  translationSource,
  translationTargetLanguage,
}) {
  const controlsDisabled = isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject;

  return (
    <>
      <h2 className="cardTitle speechUtilityTitle"><Languages size={16} /> 翻译润色</h2>
      <p className="cardSubtitle speechUtilitySubtitle">从识别预览读取文本，按选定来源执行“仅润色”或“翻译+润色”。</p>
      <div className="editorGrid three">
        <div className="formGroup">
          <label className="formLabel">来源</label>
          <select className="textInput" value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} disabled={controlsDisabled}>
            <option value="primary_local">主模型</option>
            <option value="secondary_local">小模型</option>
            <option value="openai">OpenAI API</option>
            <option value="openai_compatible">OpenAI 兼容 API</option>
            <option value="gemini">Gemini API</option>
          </select>
        </div>
        <div className="formGroup">
          <label className="formLabel">模式</label>
          <select className="textInput" value={translationMode} onChange={(event) => setTranslationMode(event.target.value)} disabled={controlsDisabled}>
            <option value="passthrough">直通</option>
            <option value="polish_only">仅润色</option>
            <option value="translate_polish">翻译+润色</option>
          </select>
        </div>
        <div className="formGroup">
          <label className="formLabel">目标语言</label>
          <select className="textInput" value={translationTargetLanguage} onChange={(event) => setTranslationTargetLanguage(event.target.value)} disabled={translationMode !== "translate_polish" || controlsDisabled}>
            <option value="中文">中文</option>
            <option value="英文">英文</option>
            <option value="日文">日文</option>
          </select>
        </div>
      </div>
      <div className="controlRow speechUtilityActions">
        <Button variant="secondary" onClick={onLoadTranslationEngine} disabled={controlsDisabled}>加载翻译引擎</Button>
        <Button variant="secondary" onClick={onUnloadTranslationEngine} disabled={controlsDisabled}>卸载翻译引擎</Button>
        <Button variant="primary" onClick={onTranslatePolish} disabled={controlsDisabled || (translationMode !== "passthrough" && !isTranslationEngineLoaded)}>
          {translationMode === "passthrough" ? "直通预览" : "翻译润色"}
        </Button>
        <Button variant="primary" icon={FolderPlus} onClick={onCreateDubbingProject} disabled={!canBuildDubbingProject || controlsDisabled}>
          {isBuildingDubbingProject ? "创建配音项目中..." : "生成翻译配音项目"}
        </Button>
        <Button variant="danger" onClick={onAbortTranslate} disabled={!isTranslating && !isBuildingDubbingProject}>
          {isBuildingDubbingProject ? "终止配音翻译" : "终止翻译"}
        </Button>
      </div>
      <div className="muted">引擎状态：{translationEngineStatus?.loaded ? "已加载" : "未加载"} · 来源：{translationEngineStatus?.source || "未选择"} · 后端：{translationEngineStatus?.backend || "unknown"}</div>
      {translationEngineStatus?.model_name ? <div className="muted">模型：{translationEngineStatus.model_name}</div> : null}
      {!isQwen3Backend && translationMode === "passthrough" ? <div className="muted">直通配音会按 Whisper 时间轴分段，并自动写入每段 speed/duration，不调用翻译引擎。</div> : null}
      {!isQwen3Backend && translationMode !== "passthrough" ? <div className="muted">配音项目会按 Whisper 时间轴分段，并自动写入每段 speed/duration。</div> : null}
      {isQwen3Backend ? <div className="muted">Qwen3-ASR 当前为纯识别模式，不支持时间轴匹配配音项目创建。</div> : null}
      {translationEngineStatus?.error ? <div className="errorText">{translationEngineStatus.error}</div> : null}
      {translationError ? <div className="errorText">{translationError}</div> : null}
      {isBuildingDubbingProject || dubbingTask.stageLabel ? (
        <div className="muted">
          配音翻译：{dubbingTask.stageLabel || dubbingTask.status || "处理中"}
          {dubbingTask.total ? ` · ${dubbingTask.processed}/${dubbingTask.total}` : ""}
          {dubbingTask.percent ? ` · ${Math.round(dubbingTask.percent)}%` : ""}
          {dubbingTask.cacheHits ? ` · 缓存命中 ${dubbingTask.cacheHits}` : ""}
        </div>
      ) : null}
      <textarea className="textArea translationResultTextArea" value={translationResult} onChange={(event) => setTranslationResult(event.target.value)} placeholder="翻译润色结果将显示在这里。" />
      <div className="controlRow">
        <Button variant="primary" onClick={onAppendTranslationToText} disabled={!canInsertTranslation}>追加到文本输入</Button>
        <Button variant="secondary" onClick={onReplaceTranslationToText} disabled={!canInsertTranslation}>替换文本输入</Button>
        <Button variant="ghost" onClick={clearTranslationResult} disabled={!translationResult}>清空翻译结果</Button>
      </div>
    </>
  );
}
