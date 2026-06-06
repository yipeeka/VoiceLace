import { CircleAlert, FileText, FolderPlus, Languages, Loader2, Square, Upload } from "lucide-react";

import { SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS } from "../../constants/speechTranslationOptions";
import Button from "../ui/Button";
import { formatTimestamp } from "../../utils/speechRecognitionFormat";

export default function SubtitleDubbingPanel({
  canCreateSubtitleProject,
  editedSubtitleSrtText,
  isCreatingSubtitleProject,
  isLoadingTranslationEngine,
  isPreviewingSubtitle,
  isTranslatingSubtitle,
  isTranslationEngineLoaded,
  onAbortSubtitleTranslate,
  onCreateSubtitleDubbingProject,
  onLoadTranslationEngine,
  onPreviewSubtitleFile,
  onSubtitleFileChange,
  onSubtitleLinePolicyChange,
  onSubtitleModeChange,
  onSubtitleProjectNameChange,
  onTranslateSubtitle,
  onTranslationSourceChange,
  onTranslationTargetLanguageChange,
  onUnloadTranslationEngine,
  setEditedSubtitleSrtText,
  setSubtitlePreview,
  subtitleCreateDisabledReason,
  subtitleError,
  subtitleFile,
  subtitleLinePolicy,
  subtitleMode,
  subtitlePreview,
  subtitleProjectName,
  subtitleTask,
  translationEngineStatus,
  translationSource,
  translationTargetLanguage,
}) {
  const controlsDisabled = isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject;
  const engineStateLabel = translationEngineStatus?.loaded ? "已加载" : isLoadingTranslationEngine ? "加载中" : "未加载";
  const engineSourceLabel = translationEngineStatus?.source || "未选择";
  const engineBackendLabel = translationEngineStatus?.backend || "unknown";
  const subtitleStateLabel = subtitlePreview
    ? `${subtitlePreview.segment_count || 0} 段`
    : subtitleFile
      ? "已选文件"
      : "未选择文件";
  const taskSummary = isTranslatingSubtitle || subtitleTask.stageLabel
    ? [
        subtitleTask.stageLabel || subtitleTask.status || "处理中",
        subtitleTask.total ? `${subtitleTask.processed}/${subtitleTask.total}` : "",
        subtitleTask.percent ? `${Math.round(subtitleTask.percent)}%` : "",
        subtitleTask.cacheHits ? `缓存 ${subtitleTask.cacheHits}` : "",
      ].filter(Boolean).join(" · ")
    : "";
  const previewMeta = subtitlePreview
    ? [
        String(subtitlePreview.format || "").toUpperCase(),
        `${subtitlePreview.segment_count || 0} 段`,
        `说话人 ${(subtitlePreview.speakers || []).join("、") || "narrator"}`,
      ].filter(Boolean).join(" · ")
    : "";
  const hasError = Boolean(subtitleError);
  const translationModeEnabled = subtitleMode === "translated";

  return (
    <div className="speechTranslationPanel speechSubtitlePanel">
      <div className="speechTranslationHeader">
        <div>
          <h2 className="cardTitle speechUtilityTitle"><FileText size={16} /> 字幕配音</h2>
          <p className="cardSubtitle speechUtilitySubtitle">从 SRT/ASS 字幕创建时间轴锁定的配音项目。</p>
        </div>
        <span className={`speechTranslationStatusPill ${subtitlePreview ? "ready" : subtitleFile ? "loading" : "idle"}`}>
          {isPreviewingSubtitle || isTranslatingSubtitle ? <Loader2 size={13} aria-hidden="true" /> : null}
          {subtitleStateLabel}
        </span>
      </div>

      <section className="speechTranslationSection">
        <div className="speechTranslationSectionHeader">
          <span>设置</span>
          <small>{translationModeEnabled ? "翻译配音需先翻译并确认预览" : "原文配音会直接使用字幕文本"}</small>
        </div>
        <div className="speechSubtitleConfigGrid">
          <div className="formGroup speechSubtitleFileGroup">
            <label className="formLabel">字幕文件</label>
            <input className="textInput" type="file" accept=".srt,.ass,text/plain" onChange={onSubtitleFileChange} disabled={controlsDisabled} />
          </div>
          <div className="formGroup">
            <label className="formLabel">项目名称</label>
            <input className="textInput" value={subtitleProjectName} onChange={(event) => onSubtitleProjectNameChange(event.target.value)} placeholder="留空按字幕文件命名" disabled={isCreatingSubtitleProject} />
          </div>
          <div className="formGroup">
            <label className="formLabel">配音模式</label>
            <select className="textInput" value={subtitleMode} onChange={(event) => onSubtitleModeChange(event.target.value)} disabled={controlsDisabled}>
              <option value="original">原文配音</option>
              <option value="translated">翻译配音</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">双语字幕行</label>
            <select className="textInput" value={subtitleLinePolicy} onChange={(event) => onSubtitleLinePolicyChange(event.target.value)} disabled={controlsDisabled}>
              <option value="auto">自动</option>
              <option value="first_line">第一行</option>
              <option value="second_line">第二行</option>
              <option value="all">全部</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">翻译来源</label>
            <select className="textInput" value={translationSource} onChange={(event) => onTranslationSourceChange(event.target.value)} disabled={!translationModeEnabled || controlsDisabled}>
              <option value="primary_local">主模型</option>
              <option value="secondary_local">小模型</option>
              <option value="openai">OpenAI API</option>
              <option value="openai_compatible">OpenAI 兼容 API</option>
              <option value="gemini">Gemini API</option>
            </select>
          </div>
          <div className="formGroup">
            <label className="formLabel">目标语言</label>
            <select className="textInput" value={translationTargetLanguage} onChange={(event) => onTranslationTargetLanguageChange(event.target.value)} disabled={!translationModeEnabled || controlsDisabled}>
              {SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="speechTranslationSection speechSubtitleRunSection">
        <div className="speechSubtitleActionGrid">
          <Button variant="secondary" onClick={onLoadTranslationEngine} disabled={!translationModeEnabled || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>加载引擎</Button>
          <Button variant="secondary" onClick={onUnloadTranslationEngine} disabled={!translationModeEnabled || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>卸载引擎</Button>
          <Button variant="secondary" icon={Upload} onClick={() => onPreviewSubtitleFile(subtitleFile, subtitleMode, subtitleLinePolicy, true)} disabled={!subtitleFile || controlsDisabled}>{isPreviewingSubtitle ? "解析中..." : "预览字幕"}</Button>
          <Button variant="primary" icon={Languages} onClick={onTranslateSubtitle} disabled={!translationModeEnabled || !subtitleFile || !isTranslationEngineLoaded || isTranslatingSubtitle || isCreatingSubtitleProject}>{isTranslatingSubtitle ? "翻译中..." : "翻译字幕"}</Button>
          <Button variant="primary" icon={FolderPlus} onClick={onCreateSubtitleDubbingProject} disabled={!canCreateSubtitleProject} title={subtitleCreateDisabledReason}>{isCreatingSubtitleProject ? "创建中..." : "配音项目"}</Button>
          <Button variant="danger" icon={Square} onClick={onAbortSubtitleTranslate} disabled={!isTranslatingSubtitle}>终止翻译</Button>
        </div>

        <div className={`speechTranslationStatusCard ${hasError ? "error" : isTranslationEngineLoaded ? "ready" : ""}`}>
          <div className="speechTranslationStatusHeader">
            <strong>状态</strong>
            <span>{translationModeEnabled ? engineStateLabel : "原文模式"}</span>
          </div>
          <div className="speechTranslationStatusMeta">
            <span>字幕 {subtitleStateLabel}</span>
            <span>来源 {translationModeEnabled ? engineSourceLabel : "无需翻译"}</span>
            <span>后端 {translationModeEnabled ? engineBackendLabel : "-"}</span>
          </div>
          {translationModeEnabled && ["openai", "openai_compatible", "gemini"].includes(translationSource) ? <div className="speechTranslationNote">API 翻译预览会并发处理；本地模型保持串行。</div> : null}
          {taskSummary ? <div className="speechTranslationTask">字幕翻译：{taskSummary}</div> : null}
          {subtitleCreateDisabledReason && subtitleFile ? <div className="speechTranslationNote">{subtitleCreateDisabledReason}</div> : null}
          {hasError ? (
            <div className="speechTranslationError">
              <CircleAlert size={14} aria-hidden="true" />
              <span>{subtitleError}</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="speechTranslationSection">
        <div className="speechTranslationSectionHeader">
          <span>预览</span>
          <small>{previewMeta || "等待字幕预览"}</small>
        </div>
        {subtitlePreview ? (
          <div className="listStack subtitlePreviewList">
            {(subtitlePreview.warnings || []).slice(0, 4).map((warning, index) => <div key={`subtitle-warning-${index}`} className="speechTranslationNote">提示：{warning}</div>)}
            <textarea
              className="textArea subtitlePreviewTextArea"
              value={editedSubtitleSrtText}
              onChange={(event) => {
                setEditedSubtitleSrtText(event.target.value);
                setSubtitlePreview((current) => {
                  if (!current?.translated_segments) return current;
                  return {
                    ...current,
                    translated_segments: undefined,
                    translated_text: "",
                    cues: (current.cues || []).map((cue) => ({ ...cue, translated_text: "" })),
                  };
                });
              }}
              placeholder="字幕全文预览将显示在这里，可直接按 SRT 格式编辑。"
              disabled={controlsDisabled}
            />
            {(subtitlePreview.cues || []).some((cue) => cue?.translated_text) ? (
              <div className="listStack speechSubtitleCueList">
                {(subtitlePreview.cues || []).map((cue) => (
                  <div key={cue.id} className="segmentMetaRow subtitleCueRow">
                    <span className="statusBadge">{formatTimestamp(cue.start_ms)} - {formatTimestamp(cue.end_ms)}</span>
                    <span className="muted subtitleCueSpeaker">{cue.speaker || "narrator"}</span>
                    <span className="subtitleCueText">
                      {cue.text}
                      {cue.translated_text ? <><br /><span className="muted">译文：</span>{cue.translated_text}</> : null}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="speechSubtitleEmptyPreview">
            <Upload size={18} aria-hidden="true" />
            <span>选择字幕文件后点击“预览字幕”。</span>
          </div>
        )}
      </section>
    </div>
  );
}
