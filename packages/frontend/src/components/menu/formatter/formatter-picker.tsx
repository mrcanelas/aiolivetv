import React from 'react';
import { Bookmark, ChevronsUpDown, Layers, PenLine } from 'lucide-react';
import { cn } from '../../ui/core/styling';

export type FormatterKind = 'builtin' | 'customised' | 'saved' | 'custom';

const KIND = {
  builtin: {
    label: 'Built-in',
    icon: Layers,
    badge: 'bg-green-500/20 text-green-400 border-green-500/30',
  },
  customised: {
    label: 'Customised',
    icon: Layers,
    badge: 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  },
  saved: {
    label: 'Saved',
    icon: Bookmark,
    badge: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  },
  custom: {
    label: 'Custom',
    icon: PenLine,
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
} as const;

export interface FormatterPickerProps {
  name: string;
  kind: FormatterKind;
  detail?: React.ReactNode;
  onOpen: () => void;
}

/** Select-style trigger showing the active formatter; opens the browser. */
export function FormatterPicker({
  name,
  kind,
  detail,
  onOpen,
}: FormatterPickerProps) {
  const { label, icon: Icon, badge } = KIND[kind];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 rounded-lg border border-[--border] bg-[--paper] px-4 py-3 text-left hover:bg-[--subtle] transition-colors"
    >
      <Icon className="h-5 w-5 shrink-0 text-[--muted]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">{name}</span>
          <span
            className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full border shrink-0',
              badge
            )}
          >
            {label}
          </span>
        </div>
        {detail ? (
          <p className="text-sm text-[--muted] mt-0.5 line-clamp-2">{detail}</p>
        ) : null}
      </div>
      <span className="text-sm text-[--muted] flex items-center gap-1 shrink-0">
        Change
        <ChevronsUpDown className="h-4 w-4" />
      </span>
    </button>
  );
}
