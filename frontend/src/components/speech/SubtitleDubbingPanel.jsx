import { FileText, FolderPlus, Upload } from "lucide-react";

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
  return (
    <>
      <h2 className="cardTitle speechUtilityTitle"><FileText size={16} /> 字幕配音</h2>
      <p className="cardSubtitle speechUtilitySubtitle">从 SRT/ASS 字幕创建带时间轴锁定的配音项目，翻译配音需先翻译并确认预览。</p>
      <div className="editorGrid three">
        <div className="formGroup">
          <label className="formLabel">字幕文件</label>
          <input className="textInput" type="file" accept=".srt,.ass,text/plain" onChange={onSubtitleFileChange} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject} />
        </div>
        <div className="formGroup">
          <label className="formLabel">项目名称</label>
          <input className="textInput" value={subtitleProjectName} onChange={(event) => onSubtitleProjectNameChange(event.target.value)} placeholder="留空按字幕文件命名" disabled={isCreatingSubtitleProject} />
        </div>
        <div className="formGroup">
          <label className="formLabel">配音模式</label>
          <select className="textInput" value={subtitleMode} onChange={(event) => onSubtitleModeChange(event.target.value)} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
            <option value="original">原文配音</option>
            <option value="translated">翻译配音</option>
          </select>
        </div>
      </div>
      <div className="editorGrid three">
        <div className="formGroup">
          <label className="formLabel">双语字幕行</label>
          <select className="textInput" value={subtitleLinePolicy} onChange={(event) => onSubtitleLinePolicyChange(event.target.value)} disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
            <option value="auto">自动</option>
            <option value="first_line">第一行</option>
            <option value="second_line">第二行</option>
            <option value="all">全部</option>
          </select>
        </div>
        <div className="formGroup">
          <label className="formLabel">翻译来源</label>
          <select className="textInput" value={translationSource} onChange={(event) => onTranslationSourceChange(event.target.value)} disabled={subtitleMode !== "translated" || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
            <option value="primary_local">模型1（主模型）</option>
            <option value="secondary_local">模型2（小模型）</option>
            <option value="openai">OpenAI API</option>
            <option value="gemini">Gemini API</option>
          </select>
        </div>
        <div className="formGroup">
          <label className="formLabel">目标语言</label>
          <select className="textInput" value={translationTargetLanguage} onChange={(event) => onTranslationTargetLanguageChange(event.target.value)} disabled={subtitleMode !== "translated" || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>
            <option value="中文">中文</option>
            <option value="英文">英文</option>
            <option value="日文">日文</option>
          </select>
        </div>
      </div>
      <div className="controlRow speechUtilityActions">
        <Button variant="secondary" onClick={onLoadTranslationEngine} disabled={subtitleMode !== "translated" || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>加载翻译引擎</Button>
        <Button variant="secondary" onClick={onUnloadTranslationEngine} disabled={subtitleMode !== "translated" || isLoadingTranslationEngine || isTranslatingSubtitle || isCreatingSubtitleProject}>卸载翻译引擎</Button>
        <Button variant="secondary" icon={Upload} onClick={() => onPreviewSubtitleFile(subtitleFile, subtitleMode, subtitleLinePolicy, true)} disabled={!subtitleFile || isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}>{isPreviewingSubtitle ? "解析中..." : "预览字幕"}</Button>
        <Button variant="primary" onClick={onTranslateSubtitle} disabled={subtitleMode !== "translated" || !subtitleFile || !isTranslationEngineLoaded || isTranslatingSubtitle || isCreatingSubtitleProject}>{isTranslatingSubtitle ? "翻译中..." : "翻译字幕"}</Button>
        <Button variant="primary" icon={FolderPlus} onClick={onCreateSubtitleDubbingProject} disabled={!canCreateSubtitleProject} title={subtitleCreateDisabledReason}>{isCreatingSubtitleProject ? "创建中..." : "创建字幕配音项目"}</Button>
        <Button variant="danger" onClick={onAbortSubtitleTranslate} disabled={!isTranslatingSubtitle}>终止字幕翻译</Button>
      </div>
      <div className="muted">翻译引擎：{translationEngineStatus?.loaded ? "已加载" : "未加载"} · 来源：{translationEngineStatus?.source || "未选择"} · 后端：{translationEngineStatus?.backend || "unknown"}</div>
      {subtitleMode === "translated" && ["openai", "gemini"].includes(translationSource) ? <div className="muted">API 翻译预览会并发处理；本地模型为保护模型实例保持串行。</div> : null}
      {isTranslatingSubtitle || subtitleTask.stageLabel ? (
        <div className="muted">
          字幕翻译：{subtitleTask.stageLabel || subtitleTask.status || "处理中"}
          {subtitleTask.total ? ` · ${subtitleTask.processed}/${subtitleTask.total}` : ""}
          {subtitleTask.percent ? ` · ${Math.round(subtitleTask.percent)}%` : ""}
          {subtitleTask.cacheHits ? ` · 缓存命中 ${subtitleTask.cacheHits}` : ""}
        </div>
      ) : null}
      {subtitleCreateDisabledReason && subtitleFile ? <div className="muted">{subtitleCreateDisabledReason}</div> : null}
      {subtitleError ? <div className="errorText">{subtitleError}</div> : null}
      {subtitlePreview ? (
        <div className="listStack subtitlePreviewList">
          <div className="muted">格式：{String(subtitlePreview.format || "").toUpperCase()} · 分段：{subtitlePreview.segment_count || 0} · 说话人：{(subtitlePreview.speakers || []).join("、") || "narrator"}</div>
          {(subtitlePreview.warnings || []).slice(0, 4).map((warning, index) => <div key={`subtitle-warning-${index}`} className="muted">提示：{warning}</div>)}
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
            disabled={isPreviewingSubtitle || isTranslatingSubtitle || isCreatingSubtitleProject}
          />
          {(subtitlePreview.cues || []).some((cue) => cue?.translated_text) ? (
            <div className="listStack">
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
      ) : null}
    </>
  );
}
