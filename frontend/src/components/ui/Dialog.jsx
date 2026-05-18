import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../utils/cn";
import Button from "./Button";

export function Dialog({ open, onOpenChange, children }) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </RadixDialog.Root>
  );
}

export function DialogTrigger({ children }) {
  return <RadixDialog.Trigger asChild>{children}</RadixDialog.Trigger>;
}

export function DialogContent({ title, description, children, className }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="dialogOverlay" />
      <RadixDialog.Content className={cn("dialogContent", className)}>
        {title && <RadixDialog.Title className="dialogTitle">{title}</RadixDialog.Title>}
        {description && (
          <RadixDialog.Description className="dialogDescription">
            {description}
          </RadixDialog.Description>
        )}
        {children}
        <RadixDialog.Close asChild>
          <button
            type="button"
            aria-label="关闭对话框"
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              borderRadius: "var(--radius-sm)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <X aria-hidden="true" focusable="false" size={16} />
          </button>
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

/** Confirm dialog with OK / Cancel */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  danger = false,
  confirmLabel = "确认",
  cancelLabel = "取消",
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <div className="controlRow" style={{ justifyContent: "flex-end", marginTop: 8 }}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => {
              onConfirm?.();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
