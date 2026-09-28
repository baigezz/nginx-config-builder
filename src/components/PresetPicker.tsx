import type { NginxPreset } from '../types/nginx'

interface PresetPickerProps {
  presets: NginxPreset[]
  onApply: (preset: NginxPreset) => void
}

export function PresetPicker({ presets, onApply }: PresetPickerProps) {
  return (
    <div className="presetGrid">
      {presets.map((preset) => (
        <button className="presetCard" key={preset.id} onClick={() => onApply(preset)}>
          <span className="presetBadge">{preset.badge}</span>
          <strong>{preset.name}</strong>
          <small>{preset.description}</small>
          <span className="presetAction">应用模板 →</span>
        </button>
      ))}
    </div>
  )
}
