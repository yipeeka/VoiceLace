import { Upload } from "lucide-react";
import { useState } from "react";
import { cn } from "../../utils/cn";

export default function FileDropZone({
  accept = "*",
  onFile,
  label = "拖拽文件到此处",
  sublabel = "或点击选择文件",
  className,
}) {
  const [isDragging, setIsDragging] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile?.(file);
  }

  function handleChange(e) {
    const file = e.target.files?.[0];
    if (file) onFile?.(file);
    e.target.value = "";
  }

  return (
    <label
      className={cn("fileDropZone", isDragging && "dragOver", className)}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <input className="visuallyHidden" type="file" accept={accept} onChange={handleChange} aria-label={label} />
      <Upload aria-hidden="true" focusable="false" size={24} className={cn("dropIcon", isDragging && "dragOver")} />
      <span style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500 }}>
        {label}
      </span>
      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{sublabel}</span>
    </label>
  );
}
