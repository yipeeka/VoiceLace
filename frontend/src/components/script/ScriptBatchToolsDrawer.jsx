import { Blend, PencilLine, Replace, Settings2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent } from "../ui/Dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs";
import Select from "../ui/Select";
import Button from "../ui/Button";
import { EMOTION_OPTIONS, TYPE_OPTIONS } from "../../constants/scriptOptions";
import { useI18n } from "../../i18n/I18nProvider";

function buildSearchPreview({ segments, find, replace, caseSensitive }) {
  if (!find) return { hitCount: 0, affectedCount: 0, rows: [] };
  let pattern;
  try {
    pattern = new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
  } catch {
    return { hitCount: 0, affectedCount: 0, rows: [] };
  }

  let hitCount = 0;
  const rows = [];
  for (const segment of segments || []) {
    const text = String(segment?.text || "");
    const matches = text.match(pattern);
    if (!matches?.length) continue;
    hitCount += matches.length;
    const replaced = text.replace(pattern, replace || "");
    rows.push({
      segmentId: segment.id,
      before: text,
      after: replaced,
      hit: matches.length,
    });
  }
  return {
    hitCount,
    affectedCount: rows.length,
    rows: rows.slice(0, 5),
  };
}

export default function ScriptBatchToolsDrawer({
  open,
  onOpenChange,
  characters = [],
  visibleSegments = [],
  activeSpeakerFilter = "all",
  canExecute = true,
  isSaving = false,
  onRenameCharacter,
  onMergeCharacter,
  onBatchUpdate,
  onSearchReplace,
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState("rename");
  const [fromName, setFromName] = useState("");
  const [toName, setToName] = useState("");
  const [mergeSourceName, setMergeSourceName] = useState("");
  const [mergeTargetName, setMergeTargetName] = useState("");
  const [fromEmotion, setFromEmotion] = useState("");
  const [targetEmotion, setTargetEmotion] = useState("");
  const [fromType, setFromType] = useState("");
  const [targetType, setTargetType] = useState("");
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);

  const characterOptions = useMemo(
    () => (characters || []).map((item) => ({ value: item.name, label: t("script.batch.characterOption", { name: item.name, count: item.count }) })),
    [characters, t]
  );

  const scopeText = t("script.batch.scopeText", {
    speaker: activeSpeakerFilter === "all" ? t("common.all") : activeSpeakerFilter,
    count: visibleSegments.length,
  });

  const renamePreviewCount = useMemo(
    () => (visibleSegments || []).filter((seg) => (seg?.speaker || "").trim() === fromName).length,
    [visibleSegments, fromName]
  );
  const mergePreviewCount = useMemo(
    () => (visibleSegments || []).filter((seg) => (seg?.speaker || "").trim() === mergeSourceName).length,
    [visibleSegments, mergeSourceName]
  );
  const emotionOptionsInScope = useMemo(() => {
    const existing = new Set((visibleSegments || []).map((seg) => (seg?.emotion || "neutral")));
    const ordered = EMOTION_OPTIONS.filter((opt) => existing.has(opt.value));
    return ordered.length ? ordered : [{ value: "neutral", label: t("script.batch.emotionNeutral") }];
  }, [visibleSegments, t]);

  const typeOptionsInScope = useMemo(() => {
    const existing = new Set((visibleSegments || []).map((seg) => (seg?.type || "dialogue")));
    const ordered = TYPE_OPTIONS.filter((opt) => existing.has(opt.value));
    return ordered.length ? ordered : [{ value: "dialogue", label: t("script.batch.typeDialogue") }];
  }, [visibleSegments, t]);

  useEffect(() => {
    const emotionValues = new Set(emotionOptionsInScope.map((opt) => opt.value));
    const typeValues = new Set(typeOptionsInScope.map((opt) => opt.value));
    if (fromEmotion && !emotionValues.has(fromEmotion)) setFromEmotion("");
    if (fromType && !typeValues.has(fromType)) setFromType("");
  }, [emotionOptionsInScope, typeOptionsInScope, fromEmotion, fromType]);

  const batchSourceMatches = useMemo(() => {
    return (visibleSegments || []).filter((seg) => {
      const segEmotion = seg?.emotion || "neutral";
      const segType = seg?.type || "dialogue";
      if (fromEmotion && segEmotion !== fromEmotion) return false;
      if (fromType && segType !== fromType) return false;
      return true;
    });
  }, [visibleSegments, fromEmotion, fromType]);

  const batchCandidates = useMemo(() => {
    return (batchSourceMatches || []).filter((seg) => {
      const segEmotion = seg?.emotion || "neutral";
      const segType = seg?.type || "dialogue";
      const willChangeEmotion = Boolean(targetEmotion) && segEmotion !== targetEmotion;
      const willChangeType = Boolean(targetType) && segType !== targetType;
      return willChangeEmotion || willChangeType;
    });
  }, [batchSourceMatches, targetEmotion, targetType]);
  const batchPreviewCount = (targetEmotion || targetType) ? batchCandidates.length : batchSourceMatches.length;
  const searchPreview = useMemo(
    () =>
      buildSearchPreview({
        segments: visibleSegments,
        find: findText,
        replace: replaceText,
        caseSensitive,
      }),
    [visibleSegments, findText, replaceText, caseSensitive]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("script.batch.title")}
        description={scopeText}
        className="batchToolsDrawer"
      >
        {!canExecute ? (
          <div className="statusBadge warning" style={{ marginBottom: 10, display: "block", textAlign: "left" }}>
            {t("script.batch.unsavedDraftWarning")}
          </div>
        ) : null}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="batchTabsList">
            <TabsTrigger value="rename"><PencilLine size={13} /> {t("script.batch.tab.rename")}</TabsTrigger>
            <TabsTrigger value="merge"><Blend size={13} /> {t("script.batch.tab.merge")}</TabsTrigger>
            <TabsTrigger value="batch"><Settings2 size={13} /> {t("script.batch.tab.batch")}</TabsTrigger>
            <TabsTrigger value="replace"><Replace size={13} /> {t("script.batch.tab.replace")}</TabsTrigger>
            <TabsTrigger value="structure"><UsersRound size={13} /> {t("script.batch.tab.structure")}</TabsTrigger>
          </TabsList>

          <TabsContent value="rename">
            <div className="listStack">
              <Select value={fromName} onValueChange={setFromName} options={characterOptions} placeholder={t("script.batch.placeholder.sourceCharacter")} />
              <input className="textInput" value={toName} onChange={(e) => setToName(e.target.value)} placeholder={t("script.batch.placeholder.newCharacterName")} />
              <div className="muted">{t("script.batch.previewAffected", { count: renamePreviewCount })}</div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !fromName || !toName || fromName === toName || renamePreviewCount <= 0}
                  onClick={() => onRenameCharacter?.({ fromName, toName })}
                >
                  {isSaving ? t("script.batch.executing") : t("script.batch.action.rename")}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="merge">
            <div className="listStack">
              <Select value={mergeSourceName} onValueChange={setMergeSourceName} options={characterOptions} placeholder={t("script.batch.placeholder.mergeSource")} />
              <Select value={mergeTargetName} onValueChange={setMergeTargetName} options={characterOptions} placeholder={t("script.batch.placeholder.mergeTarget")} />
              <div className="muted">{t("script.batch.previewMergeAffected", { count: mergePreviewCount })}</div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !mergeSourceName || !mergeTargetName || mergeSourceName === mergeTargetName || mergePreviewCount <= 0}
                  onClick={() => onMergeCharacter?.({ sourceName: mergeSourceName, targetName: mergeTargetName })}
                >
                  {isSaving ? t("script.batch.executing") : t("script.batch.action.merge")}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="batch">
            <div className="listStack">
              <div className="muted">{t("script.batch.emotionToTarget")}</div>
              <Select
                value={fromEmotion}
                onValueChange={setFromEmotion}
                options={[{ value: "", label: t("script.batch.option.allEmotions") }, ...emotionOptionsInScope]}
                placeholder={t("script.batch.placeholder.sourceEmotion")}
              />
              <Select
                value={targetEmotion}
                onValueChange={setTargetEmotion}
                options={[{ value: "", label: t("script.batch.option.keepTargetEmotion") }, ...EMOTION_OPTIONS]}
                placeholder={t("script.batch.placeholder.targetEmotion")}
              />
              <div className="muted">{t("script.batch.typeToTarget")}</div>
              <Select
                value={fromType}
                onValueChange={setFromType}
                options={[{ value: "", label: t("script.batch.option.allTypes") }, ...typeOptionsInScope]}
                placeholder={t("script.batch.placeholder.sourceType")}
              />
              <Select
                value={targetType}
                onValueChange={setTargetType}
                options={[{ value: "", label: t("script.batch.option.keepTargetType") }, ...TYPE_OPTIONS]}
                placeholder={t("script.batch.placeholder.targetType")}
              />
              <div className="muted">
                {t("script.batch.previewAffected", { count: batchPreviewCount })}
                {targetEmotion || targetType
                  ? t("script.batch.previewWillChangeTo", { emotion: targetEmotion || t("script.batch.keep"), type: targetType || t("script.batch.keep") })
                  : t("script.batch.previewSelectTargetHint")}
              </div>
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || (!targetEmotion && !targetType) || batchPreviewCount <= 0}
                  onClick={() =>
                    onBatchUpdate?.({
                      segmentIds: batchCandidates.map((seg) => seg.id),
                      emotion: targetEmotion || null,
                      type: targetType || null,
                    })
                  }
                >
                  {isSaving ? t("script.batch.executing") : t("script.batch.action.batchUpdate")}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="replace">
            <div className="listStack">
              <input className="textInput" value={findText} onChange={(e) => setFindText(e.target.value)} placeholder={t("script.batch.placeholder.findText")} />
              <input className="textInput" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder={t("script.batch.placeholder.replaceText")} />
              <label className="controlRow" style={{ justifyContent: "flex-start", gap: 8 }}>
                <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
                {t("script.batch.caseSensitive")}
              </label>
              <div className="muted">{t("script.batch.previewHits", { hit: searchPreview.hitCount, count: searchPreview.affectedCount })}</div>
              {searchPreview.rows.length ? (
                <div className="listStack" style={{ maxHeight: 180, overflowY: "auto" }}>
                  {searchPreview.rows.map((row) => (
                    <div key={row.segmentId} className="statRow" style={{ display: "block" }}>
                      <div className="muted">{t("script.batch.rowHit", { id: row.segmentId, hit: row.hit })}</div>
                      <div className="muted">{t("script.batch.before")}{row.before}</div>
                      <div className="muted">{t("script.batch.after")}{row.after}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="controlRow" style={{ justifyContent: "flex-end" }}>
                <Button
                  variant="primary"
                  disabled={isSaving || !findText || searchPreview.affectedCount <= 0}
                  onClick={() => onSearchReplace?.({ find: findText, replace: replaceText, caseSensitive })}
                >
                  {isSaving ? t("script.batch.executing") : t("script.batch.action.replace")}
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="structure">
            <div className="listStack">
              <div className="muted">{t("script.batch.structureHint.title")}</div>
              <div className="muted">{t("script.batch.structureHint.step1")}</div>
              <div className="muted">{t("script.batch.structureHint.step2")}</div>
              <div className="statusBadge default">{t("script.batch.structureHint.rollback")}</div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
