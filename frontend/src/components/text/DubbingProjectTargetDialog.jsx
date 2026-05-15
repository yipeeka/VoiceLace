import { useEffect, useState } from "react";

import Button from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";

export default function DubbingProjectTargetDialog({
  open,
  kindLabel,
  defaultName,
  currentProject,
  onCancel,
  onCreateNew,
  onUseCurrent,
}) {
  const [name, setName] = useState(defaultName || "");

  useEffect(() => {
    if (open) {
      setName(defaultName || "");
    }
  }, [defaultName, open]);

  const canUseCurrent = Boolean(currentProject?.id);
  const projectName = name.trim() || defaultName || "配音项目";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel?.(); }}>
      <DialogContent
        title={kindLabel || "配音项目"}
        description="请选择创建新项目，或继续使用当前项目。继续使用当前项目会覆盖当前项目的剧本片段。"
      >
        <div className="dialogFormStack">
          <label className="fieldLabel">
            新项目名称
            <input
              className="textInput"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={defaultName || "配音项目"}
            />
          </label>
          {canUseCurrent ? (
            <div className="statusBadge warning blockStatus">
              当前项目：{currentProject.name}。选择“使用当前项目”会覆盖它的片段列表。
            </div>
          ) : (
            <div className="muted">当前没有已选择项目，将创建新项目。</div>
          )}
          <div className="controlRow dialogActionRow">
            <Button variant="ghost" onClick={onCancel}>取消</Button>
            {canUseCurrent ? (
              <Button variant="secondary" onClick={() => onUseCurrent?.()}>使用当前项目</Button>
            ) : null}
            <Button variant="primary" onClick={() => onCreateNew?.(projectName)}>创建新项目</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
