import * as RadixSlider from "@radix-ui/react-slider";
import { cn } from "../../utils/cn";

/**
 * Props:
 *   label, value, onValueChange, min, max, step, unit, disabled
 */
export default function Slider({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
  disabled = false,
  hideValue = false,
  className,
}) {
  const displayValue = Array.isArray(value) ? value[0] : value;
  const safeValue = Array.isArray(value) ? value : [value ?? min];

  return (
    <div className={cn("formGroup", className)}>
      {label && (
        <div className="controlRow" style={{ justifyContent: "space-between" }}>
          <label className="formLabel">{label}</label>
          <span className="sliderValue">
            {displayValue}
            {unit}
          </span>
        </div>
      )}
      <div className="sliderRow">
        <RadixSlider.Root
          className="sliderRoot"
          value={safeValue}
          onValueChange={onValueChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        >
          <RadixSlider.Track className="sliderTrack">
            <RadixSlider.Range className="sliderRange" />
          </RadixSlider.Track>
          <RadixSlider.Thumb className="sliderThumb" />
        </RadixSlider.Root>
        {!label && !hideValue && (
          <span className="sliderValue">
            {displayValue}
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}
