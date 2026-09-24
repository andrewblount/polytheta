"use client";

import { useState } from "react";

// A form-submittable range slider with the live value beside it. The hidden
// input carries the value in server-action forms; onChange lets a parent
// recalculate while the thumb moves.
export function PercentSlider({ name, label, defaultValue, min, max, step, hint, onChange }: {
  name: string; label: string; defaultValue: number; min: number; max: number; step: number; hint?: string;
  onChange?: (value: number) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  const id = `slider-${name}`;
  return (
    <div className="grid gap-2 text-sm">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono text-base font-semibold tabular-nums">{value}%</span>
      </div>
      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="w-full accent-[var(--accent)]"
        onChange={(e) => { const v = Number(e.target.value); setValue(v); onChange?.(v); }}
        aria-valuetext={`${value}%`}
      />
      <div className="flex justify-between text-[11px] text-muted-foreground"><span>{min}%</span><span>{max}%</span></div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}
