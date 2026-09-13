import React, { createContext, useContext, useMemo, useState } from 'react';
import { cn } from '../../../ui/core/styling';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../../ui/accordion';
import { TextInput } from '../../../ui/text-input';
import { NumberInput } from '../../../ui/number-input';
import { Select } from '../../../ui/select';
import { Switch } from '../../../ui/switch';

/** One control can drive several template fields, e.g. every language variant. */
export type FieldRef = string | readonly string[];

interface PreviewFieldsContextValue {
  used: ReadonlySet<string>;
  onlyUsed: boolean;
}

const PreviewFieldsContext = createContext<PreviewFieldsContextValue>({
  used: new Set(),
  onlyUsed: false,
});

export function PreviewFieldsProvider({
  used,
  onlyUsed,
  children,
}: PreviewFieldsContextValue & { children: React.ReactNode }) {
  const value = useMemo(() => ({ used, onlyUsed }), [used, onlyUsed]);
  return (
    <PreviewFieldsContext.Provider value={value}>
      {children}
    </PreviewFieldsContext.Provider>
  );
}

function refs(field: FieldRef): readonly string[] {
  return typeof field === 'string' ? [field] : field;
}

export function useFieldState(field: FieldRef, always = false) {
  const { used, onlyUsed } = useContext(PreviewFieldsContext);
  const isUsed = refs(field).some((name) => used.has(name));
  return { isUsed, visible: always || isUsed || !onlyUsed };
}

/** How many of these fields render under the current filter. */
export function useVisibleCount(fields: readonly FieldRef[]) {
  const { used, onlyUsed } = useContext(PreviewFieldsContext);
  if (!onlyUsed) return fields.length;
  return fields.filter((field) => refs(field).some((name) => used.has(name)))
    .length;
}

export function FieldLabel({
  label,
  field,
  isUsed,
}: {
  label: React.ReactNode;
  field: FieldRef;
  isUsed: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="truncate">{label}</span>
      {isUsed && (
        <span
          className="size-1.5 rounded-full bg-[--brand] flex-shrink-0"
          title={refs(field).join(', ')}
        />
      )}
    </span>
  );
}

export function FieldGrid({
  cols = 3,
  children,
}: {
  cols?: 2 | 3 | 4;
  children: React.ReactNode;
}) {
  const colsClass = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-3',
    4: 'sm:grid-cols-4',
  }[cols];
  return (
    <div className={cn('grid grid-cols-1 gap-4', colsClass)}>{children}</div>
  );
}

export function SwitchRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">{children}</div>
  );
}

/**
 * The rarely-touched half of a section. Collapsed by default, and gone entirely
 * when the used-fields filter would empty it.
 */
export function AdvancedFields({
  fields,
  children,
}: {
  fields: readonly FieldRef[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState('');
  const visibleCount = useVisibleCount(fields);
  if (visibleCount === 0) return null;
  return (
    <Accordion type="single" collapsible value={open} onValueChange={setOpen}>
      <AccordionItem value="advanced" className="border-none">
        <AccordionTrigger className="py-2 text-sm text-[--muted]">
          Advanced ({visibleCount})
        </AccordionTrigger>
        <AccordionContent>{children}</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

export function FieldNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[--muted]">{children}</p>;
}

interface BaseFieldProps {
  field: FieldRef;
  label: React.ReactNode;
  help?: React.ReactNode;
  disabled?: boolean;
  always?: boolean;
}

export function TextField({
  field,
  label,
  help,
  disabled,
  always,
  value,
  onChange,
  placeholder,
  error,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}) {
  const { visible, isUsed } = useFieldState(field, always);
  if (!visible) return null;
  return (
    <TextInput
      label={<FieldLabel label={label} field={field} isUsed={isUsed} />}
      help={help}
      error={error}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      onValueChange={(next) => onChange(next ?? '')}
      className="w-full"
    />
  );
}

export function NumberField({
  field,
  label,
  help,
  disabled,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: BaseFieldProps & {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  const { visible, isUsed } = useFieldState(field);
  if (!visible) return null;
  return (
    <NumberInput
      label={<FieldLabel label={label} field={field} isUsed={isUsed} />}
      help={help}
      disabled={disabled}
      value={value ?? ''}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onValueChange={(next, asString) =>
        onChange(asString === '' || Number.isNaN(next) ? undefined : next)
      }
      className="w-full"
    />
  );
}

export function SelectField({
  field,
  label,
  help,
  disabled,
  value,
  onChange,
  options,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
}) {
  const { visible, isUsed } = useFieldState(field);
  if (!visible) return null;
  return (
    <Select
      label={<FieldLabel label={label} field={field} isUsed={isUsed} />}
      help={help}
      disabled={disabled}
      value={value}
      options={options}
      onValueChange={onChange}
      className="w-full"
    />
  );
}

export function SwitchField({
  field,
  label,
  help,
  disabled,
  value,
  onChange,
}: BaseFieldProps & {
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { visible, isUsed } = useFieldState(field);
  if (!visible) return null;
  return (
    <Switch
      label={<FieldLabel label={label} field={field} isUsed={isUsed} />}
      moreHelp={help}
      disabled={disabled}
      value={value}
      onValueChange={onChange}
    />
  );
}

/** Free-text list, entered comma separated as the ranked-regex inputs already are. */
export function ListField({
  field,
  label,
  help,
  disabled,
  value,
  onChange,
  placeholder,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <TextField
      field={field}
      label={label}
      help={help}
      disabled={disabled}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}
