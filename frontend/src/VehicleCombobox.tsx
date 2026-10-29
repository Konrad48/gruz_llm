import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

interface Props {
  label: string;
  value: string;
  options: string[];
  placeholder: string;
  customLabel: string;
  hint: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export default function VehicleCombobox({
  label,
  value,
  options,
  placeholder,
  customLabel,
  hint,
  disabled,
  onChange,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim();
  const exact = options.some(
    (option) => option.toLowerCase() === query.toLowerCase(),
  );
  const matches = options.filter(
    (option) => exact || option.toLowerCase().includes(query.toLowerCase()),
  );
  const choices = [...matches, ...(!exact && query ? [query] : [])];

  function select(choice: string) {
    onChange(choice);
    setOpen(false);
    setActive(-1);
    input.current?.focus();
  }

  function move(index: number) {
    setOpen(true);
    setActive(index);
    requestAnimationFrame(() =>
      document
        .getElementById(`${id}-option-${index}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }

  return (
    <div
      className="vehicle-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className={`vehicle-combobox ${open ? "is-expanded" : ""}`}>
        <input
          ref={input}
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-activedescendant={
            open && active >= 0 && active < choices.length
              ? `${id}-option-${active}`
              : undefined
          }
          autoComplete="off"
          required
          maxLength={80}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (choices.length)
                move(
                  event.key === "ArrowDown"
                    ? Math.min(active + 1, choices.length - 1)
                    : active < 0
                      ? choices.length - 1
                      : Math.max(active - 1, 0),
                );
              else setOpen(true);
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (active >= 0 && choices[active]) select(choices[active]);
              else setOpen(false);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        <button
          type="button"
          className="combobox-toggle"
          aria-label={label}
          disabled={disabled}
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            input.current?.focus();
            setOpen(!open);
            setActive(-1);
          }}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && (
        <div className="combobox-popover">
          <div className="combobox-caption">
            <Search size={12} />
            <span>{label}</span>
            <span>{matches.length}</span>
          </div>
          <div
            id={`${id}-listbox`}
            role="listbox"
            aria-label={label}
            className="combobox-options"
          >
            {choices.map((choice, index) => {
              const custom = index >= matches.length;
              return (
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  aria-selected={choice === value}
                  tabIndex={-1}
                  key={`${custom ? "custom" : "option"}-${choice}`}
                  className={`combobox-option ${active === index ? "is-active" : ""} ${custom ? "custom-option" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => select(choice)}
                >
                  {custom && <Plus size={13} />}
                  <span>{custom ? `${customLabel} “${choice}”` : choice}</span>
                  {!custom && choice === value && <Check size={14} />}
                </button>
              );
            })}
          </div>
          {!choices.length && <p className="combobox-empty">{hint}</p>}
          <div className="combobox-footer">{hint}</div>
        </div>
      )}
    </div>
  );
}
