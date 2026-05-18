import { useUiStore } from "../../stores/useUiStore";
import { ConfirmDialog } from "../ui/Dialog";

export default function GlobalConfirmDialog() {
  const confirmDialog = useUiStore((state) => state.confirmDialog);
  const resolveConfirm = useUiStore((state) => state.resolveConfirm);

  return (
    <ConfirmDialog
      open={Boolean(confirmDialog)}
      onOpenChange={(open) => {
        if (!open) resolveConfirm(false);
      }}
      title={confirmDialog?.title || "确认操作"}
      description={confirmDialog?.description || ""}
      danger={Boolean(confirmDialog?.danger)}
      confirmLabel={confirmDialog?.confirmLabel || "确认"}
      cancelLabel={confirmDialog?.cancelLabel || "取消"}
      onConfirm={() => resolveConfirm(true)}
    />
  );
}
