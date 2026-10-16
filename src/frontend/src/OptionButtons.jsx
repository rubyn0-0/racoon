// A row of segmented buttons. Without isActive the buttons are plain actions, not toggles.
function OptionButtons({ label, options, isActive, onSelect, showLabel = false, disabled = false }) {
  return (
    <div className="option-group" role="group" aria-label={label}>
      {showLabel && <span className="option-label">{label}</span>}
      <div className="segmented">
        {options.map((option) => {
          const active = isActive?.(option.id)

          return (
            <button
              key={option.id}
              type="button"
              className={active ? 'segment active' : 'segment'}
              aria-pressed={isActive ? active : undefined}
              disabled={disabled}
              onClick={() => onSelect(option.id)}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default OptionButtons
