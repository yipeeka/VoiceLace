import { useEffect, useRef, useState } from "react";

import { useUiStore } from "../../stores/useUiStore";
import Button from "../ui/Button";
import { Dialog, DialogContent } from "../ui/Dialog";

export default function GlobalPromptDialog() {
  const promptDialog = useUiStore((state) => state.promptDialog);
  const resolvePrompt = useUiStore((state) => state.resolvePrompt);
  const [value, setValue] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!promptDialog) return;
    setValue(promptDialog.defaultValue || "");
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  }, [promptDialog]);

  function handleSubmit(event) {
    event.preventDefault();
    resolvePrompt(value);
  }

  return (
    <Dialog
      open={Boolean(promptDialog)}
      onOpenChange={(open) => {
        if (!open) resolvePrompt(null);
      }}
    >
      <DialogContent
        title={promptDialog?.title || "输入内容"}
        description={promptDialog?.description || ""}
      >
        <form className="dialogFormStack" onSubmit={handleSubmit}>
          <label className="fieldLabel">
            {promptDialog?.label || "名称"}
            <input
              ref={inputRef}
              className="textInput"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={promptDialog?.placeholder || ""}
            />
          </label>
          <div className="controlRow dialogActionRow">
            <Button variant="ghost" onClick={() => resolvePrompt(null)}>
              {promptDialog?.cancelLabel || "取消"}
            </Button>
            <Button variant="primary" type="submit">
              {promptDialog?.confirmLabel || "确认"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
