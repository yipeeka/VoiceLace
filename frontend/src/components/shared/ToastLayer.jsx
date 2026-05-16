import * as Toast from "@radix-ui/react-toast";
import { CheckCircle, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { useUiStore } from "../../stores/useUiStore";

const TONE_CONFIG = {
  success: { icon: CheckCircle, iconColor: "var(--success)" },
  error:   { icon: XCircle,     iconColor: "var(--danger)" },
  warning: { icon: TriangleAlert, iconColor: "var(--warning)" },
  default: { icon: Info,         iconColor: "var(--info)" },
};

function ToastItem({ toast, onDismiss }) {
  const config = TONE_CONFIG[toast.tone] ?? TONE_CONFIG.default;
  const Icon = config.icon;

  return (
    <Toast.Root
      className={`toastRoot ${toast.tone || "default"}`}
      open
      onOpenChange={(open) => { if (!open) onDismiss(toast.id); }}
      duration={toast.duration ?? 4000}
    >
      <Icon aria-hidden="true" focusable="false" size={16} style={{ color: config.iconColor, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <Toast.Title className="toastTitle">{toast.title}</Toast.Title>
        {toast.description && (
          <Toast.Description className="toastDescription">{toast.description}</Toast.Description>
        )}
      </div>
      <Toast.Action asChild altText="关闭通知">
        <button type="button" className="toastClose" onClick={() => onDismiss(toast.id)} aria-label="关闭通知">
          <X aria-hidden="true" focusable="false" size={13} />
        </button>
      </Toast.Action>
    </Toast.Root>
  );
}

export default function ToastLayer() {
  const { toasts, dismissToast } = useUiStore();

  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={dismissToast} />
      ))}
      <Toast.Viewport className="toastViewport" />
    </Toast.Provider>
  );
}
