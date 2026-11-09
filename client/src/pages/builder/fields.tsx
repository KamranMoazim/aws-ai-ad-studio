import type { ReactNode } from 'react';
import { COLOR_PREFIX, HEX_PATTERN, type ColorRole } from '../../../../shared/src/index';

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="field">
      {label}
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
      />
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: Array<[T | '', string]>;
  onChange: (value: T | undefined) => void;
}) {
  return (
    <label className="field">
      {label}
      <select
        value={value ?? ''}
        onChange={(event) => onChange((event.target.value || undefined) as T)}
      >
        {options.map(([option, text]) => (
          <option key={option} value={option}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({
  label,
  value,
  roles,
  onChange,
}: {
  label: string;
  value: string | undefined;
  roles: ColorRole[];
  onChange: (value: string | undefined) => void;
}) {
  const isRole = value?.startsWith(COLOR_PREFIX);
  const hex = value && HEX_PATTERN.test(value) ? value : '#000000';
  return (
    <label className="field">
      {label}
      <span className="color-input">
        <select
          value={isRole ? value : value ? 'hex' : ''}
          onChange={(event) => {
            const choice = event.target.value;
            onChange(choice === 'hex' ? hex : choice || undefined);
          }}
        >
          <option value="">None</option>
          {roles.map((role) => (
            <option key={role} value={`${COLOR_PREFIX}${role}`}>
              Role: {role}
            </option>
          ))}
          <option value="hex">Fixed color</option>
        </select>
        {value && !isRole && (
          <input type="color" value={hex} onChange={(event) => onChange(event.target.value)} />
        )}
      </span>
    </label>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="builder-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
