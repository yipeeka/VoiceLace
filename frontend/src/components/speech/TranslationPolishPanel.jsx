import { CircleAlert, FolderPlus, Languages, Loader2, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useId } from "react";

import { SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS } from "../../constants/speechTranslationOptions";
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
  const generatedId = useId();
  const sourceSelectId = `${generatedId}-translation-source`;
  const modeSelectId = `${generatedId}-translation-mode`;
  const targetLanguageSelectId = `${generatedId}-translation-target-language`;
  const controlsDisabled = isLoadingTranslationEngine || isTranslating || isCreatingProject || isBuildingDubbingProject;
  const engineStateLabel = translationEngineStatus?.loaded ? "已加载" : isLoadingTranslationEngine ? "加载中" : "未加载";
  const engineSourceLabel = translationEngineStatus?.source || "未选择";
  const engineBackendLabel = translationEngineStatus?.backend || "unknown";
  const hasError = Boolean(translationEngineStatus?.error || translationError);
  const taskSummary = isBuildingDubbingProject || dubbingTask.stageLabel
    ? [
        dubbingTask.stageLabel || dubbingTask.status || "处理中",
        dubbingTask.total ? `${dubbingTask.processed}/${dubbingTask.total}` : "",
        dubbingTask.percent ? `${Math.round(dubbingTask.percent)}%` : "",
        dubbingTask.cacheHits ? `缓存 ${dubbingTask.cacheHits}` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const modeHint = translationMode === "passthrough"
    ? "直通配音按 ASR 时间轴分段，不调用翻译引擎。"
    : "配音项目会写入每段 speed/duration。";

  return (
    <div className="speechTranslationPanel">
      <div className="speechTranslationHeader">
        <div>
          <h2 className="cardTitle speechUtilityTitle"><Languages size={16} /> 翻译润色</h2>
          <p className="cardSubtitle speechUtilitySubtitle">读取识别预览，生成润色文本或配音项目。</p>
        </div>
        <span className={`speechTranslationStatusPill ${isTranslationEngineLoaded ? "ready" : isLoadingTranslationEngine ? "loading" : "idle"}`}>
          {isLoadingTranslationEngine ? <Loader2 size={13} aria-hidden="true" /> : null}
          {engineStateLabel}
        </span>
      </div>

      <section className="speechTranslationSection">
        <div className="speechTranslationSectionHeader">
          <span>设置</span>
          <small>{modeHint}</small>
        </div>
        <div className="speechTranslationConfigGrid">
          <div className="formGroup">
            <label className="formLabel" htmlFor={sourceSelectId}>来源</label>
            <select id={sourceSelectId} className="textInput" value={translationSource} onChange={(event) => setTranslationSource(event.target.value)} disabled={controlsDisabled}>
              <option value="primary_local">主模型</option>
              <option value="secondary_local">小模型</option>
              <option value="openai">OpenAI API</option>
              <option value="openai_compatible">OpenAI 兼容 API</option>
              <option value="gemini">Gemini API</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel" htmlFor={modeSelectId}>模式</label>
            <select id={modeSelectId} className="textInput" value={translationMode} onChange={(event) => setTranslationMode(event.target.value)} disabled={controlsDisabled}>
              <option value="passthrough">直通</option>
              <option value="polish_only">仅润色</option>
              <option value="translate_polish">翻译+润色</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel" htmlFor={targetLanguageSelectId}>目标语言</label>
            <select id={targetLanguageSelectId} className="textInput" value={translationTargetLanguage} onChange={(event) => setTranslationTargetLanguage(event.target.value)} disabled={translationMode !== "translate_polish" || controlsDisabled}>
              {SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="speechTranslationSection speechTranslationRunSection">
        <div className="speechTranslationActionGrid">
          <Button variant="secondary" onClick={onLoadTranslationEngine} disabled={controlsDisabled}>加载引擎</Button>
          <Button variant="secondary" onClick={onUnloadTranslationEngine} disabled={controlsDisabled}>卸载引擎</Button>
          <Button variant="primary" icon={Play} onClick={onTranslatePolish} disabled={controlsDisabled || (translationMode !== "passthrough" && !isTranslationEngineLoaded)}>
            {translationMode === "passthrough" ? "直通预览" : "翻译润色"}
          </Button>
          <Button variant="primary" icon={FolderPlus} onClick={onCreateDubbingProject} disabled={!canBuildDubbingProject || controlsDisabled}>
            {isBuildingDubbingProject ? "创建中..." : "配音项目"}
          </Button>
          <Button variant="danger" onClick={onAbortTranslate} disabled={!isTranslating && !isBuildingDubbingProject}>
            {isBuildingDubbingProject ? "终止配音" : "终止翻译"}
          </Button>
        </div>

        <div className={`speechTranslationStatusCard ${hasError ? "error" : isTranslationEngineLoaded ? "ready" : ""}`}>
          <div className="speechTranslationStatusHeader">
            <strong>引擎</strong>
            <span>{engineStateLabel}</span>
          </div>
          <div className="speechTranslationStatusMeta">
            <span>来源 {engineSourceLabel}</span>
            <span>后端 {engineBackendLabel}</span>
            {translationEngineStatus?.model_name ? <span>模型 {translationEngineStatus.model_name}</span> : null}
          </div>
          {taskSummary ? <div className="speechTranslationTask">配音翻译：{taskSummary}</div> : null}
          {isQwen3Backend ? <div className="speechTranslationNote">Qwen3-ASR 需要 ForcedAligner 和时间轴。</div> : null}
          {hasError ? (
            <div className="speechTranslationError">
              <CircleAlert size={14} aria-hidden="true" />
              <span>{translationEngineStatus?.error || translationError}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="speechTranslationSection">
        <div className="speechTranslationSectionHeader">
          <span>结果</span>
          <small>{translationResult ? `${translationResult.length.toLocaleString("zh-CN")} 字` : "等待输出"}</small>
        </div>
        <textarea className="textArea translationResultTextArea" value={translationResult} onChange={(event) => setTranslationResult(event.target.value)} placeholder="翻译润色结果将显示在这里。" />
        <div className="controlRow speechTranslationResultActions">
          <Button variant="primary" icon={Plus} onClick={onAppendTranslationToText} disabled={!canInsertTranslation}>追加到文本</Button>
          <Button variant="secondary" icon={RotateCcw} onClick={onReplaceTranslationToText} disabled={!canInsertTranslation}>替换文本</Button>
          <Button variant="ghost" icon={Trash2} onClick={clearTranslationResult} disabled={!translationResult}>清空</Button>
        </div>
      </section>
    </div>
  );
}
