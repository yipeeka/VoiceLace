import GlassCard from "../shared/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import SubtitleDubbingPanel from "./SubtitleDubbingPanel";
import TranslationPolishPanel from "./TranslationPolishPanel";

export default function SpeechUtilityTabs({
  canBuildDubbingProject,
  canCreateSubtitleProject,
  canInsertTranslation,
  clearTranslationResult,
  dubbingTask,
  editedSubtitleSrtText,
  isBuildingDubbingProject,
  isCreatingProject,
  isCreatingSubtitleProject,
  isLoadingTranslationEngine,
  isPreviewingSubtitle,
  isQwen3Backend,
  isTranslating,
  isTranslatingSubtitle,
  isTranslationEngineLoaded,
  onAbortSubtitleTranslate,
  onAbortTranslate,
  onAppendTranslationToText,
  onCreateDubbingProject,
  onCreateSubtitleDubbingProject,
  onLoadTranslationEngine,
  onPreviewSubtitleFile,
  onReplaceTranslationToText,
  onSubtitleFileChange,
  onSubtitleLinePolicyChange,
  onSubtitleModeChange,
  onSubtitleProjectNameChange,
  onTranslatePolish,
  onTranslateSubtitle,
  onUnloadTranslationEngine,
  onUtilityTabChange,
  setEditedSubtitleSrtText,
  setSubtitlePreview,
  setTranslationMode,
  setTranslationResult,
  setTranslationSource,
  setTranslationTargetLanguage,
  subtitleCreateDisabledReason,
  subtitleError,
  subtitleFile,
  subtitleLinePolicy,
  subtitleMode,
  subtitlePreview,
  subtitleProjectName,
  subtitleTask,
  translationEngineStatus,
  translationError,
  translationMode,
  translationResult,
  translationSource,
  translationTargetLanguage,
  utilityTab,
}) {
  return (
    <GlassCard>
      <Tabs value={utilityTab} onValueChange={onUtilityTabChange}>
        <TabsList>
          <TabsTrigger value="translate">翻译润色</TabsTrigger>
          <TabsTrigger value="subtitle">字幕配音</TabsTrigger>
        </TabsList>

        <TabsContent value="translate" className="speechUtilityTabContent">
          <TranslationPolishPanel
            canBuildDubbingProject={canBuildDubbingProject}
            canInsertTranslation={canInsertTranslation}
            clearTranslationResult={clearTranslationResult}
            dubbingTask={dubbingTask}
            isBuildingDubbingProject={isBuildingDubbingProject}
            isCreatingProject={isCreatingProject}
            isLoadingTranslationEngine={isLoadingTranslationEngine}
            isQwen3Backend={isQwen3Backend}
            isTranslating={isTranslating}
            isTranslationEngineLoaded={isTranslationEngineLoaded}
            onAbortTranslate={onAbortTranslate}
            onAppendTranslationToText={onAppendTranslationToText}
            onCreateDubbingProject={onCreateDubbingProject}
            onLoadTranslationEngine={onLoadTranslationEngine}
            onReplaceTranslationToText={onReplaceTranslationToText}
            onTranslatePolish={onTranslatePolish}
            onUnloadTranslationEngine={onUnloadTranslationEngine}
            setTranslationMode={setTranslationMode}
            setTranslationResult={setTranslationResult}
            setTranslationSource={setTranslationSource}
            setTranslationTargetLanguage={setTranslationTargetLanguage}
            translationEngineStatus={translationEngineStatus}
            translationError={translationError}
            translationMode={translationMode}
            translationResult={translationResult}
            translationSource={translationSource}
            translationTargetLanguage={translationTargetLanguage}
          />
        </TabsContent>

        <TabsContent value="subtitle" className="speechUtilityTabContent">
          <SubtitleDubbingPanel
            canCreateSubtitleProject={canCreateSubtitleProject}
            editedSubtitleSrtText={editedSubtitleSrtText}
            isCreatingSubtitleProject={isCreatingSubtitleProject}
            isLoadingTranslationEngine={isLoadingTranslationEngine}
            isPreviewingSubtitle={isPreviewingSubtitle}
            isTranslatingSubtitle={isTranslatingSubtitle}
            isTranslationEngineLoaded={isTranslationEngineLoaded}
            onAbortSubtitleTranslate={onAbortSubtitleTranslate}
            onCreateSubtitleDubbingProject={onCreateSubtitleDubbingProject}
            onLoadTranslationEngine={onLoadTranslationEngine}
            onPreviewSubtitleFile={onPreviewSubtitleFile}
            onSubtitleFileChange={onSubtitleFileChange}
            onSubtitleLinePolicyChange={onSubtitleLinePolicyChange}
            onSubtitleModeChange={onSubtitleModeChange}
            onSubtitleProjectNameChange={onSubtitleProjectNameChange}
            onTranslateSubtitle={onTranslateSubtitle}
            onTranslationSourceChange={setTranslationSource}
            onTranslationTargetLanguageChange={setTranslationTargetLanguage}
            onUnloadTranslationEngine={onUnloadTranslationEngine}
            setEditedSubtitleSrtText={setEditedSubtitleSrtText}
            setSubtitlePreview={setSubtitlePreview}
            subtitleCreateDisabledReason={subtitleCreateDisabledReason}
            subtitleError={subtitleError}
            subtitleFile={subtitleFile}
            subtitleLinePolicy={subtitleLinePolicy}
            subtitleMode={subtitleMode}
            subtitlePreview={subtitlePreview}
            subtitleProjectName={subtitleProjectName}
            subtitleTask={subtitleTask}
            translationEngineStatus={translationEngineStatus}
            translationSource={translationSource}
            translationTargetLanguage={translationTargetLanguage}
          />
        </TabsContent>
      </Tabs>
    </GlassCard>
  );
}
