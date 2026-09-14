import React from 'react';
import { GlowCard } from '../../../shared/glow-card';
import { cn } from '../../../ui/core/styling';
import { FormatterPreviewBox } from '../preview/preview-box';
import type { CardPreview } from './use-card-previews';

interface FormatterCardProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  preview?: CardPreview;
  active?: boolean;
  actions?: React.ReactNode;
  header?: React.ReactNode;
}

export function FormatterCard({
  title,
  description,
  badge,
  preview,
  active = false,
  actions,
  header,
}: FormatterCardProps) {
  return (
    <GlowCard
      className={cn(
        'flex flex-col gap-3 p-4',
        active && 'border-[--brand]/60 ring-1 ring-[--brand]/30'
      )}
    >
      {header ?? (
        <div>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold leading-tight min-w-0">{title}</h3>
            {(active || badge) && (
              <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                {active && (
                  <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand/20 text-[--brand] border border-[--brand]/30">
                    Active
                  </span>
                )}
                {badge}
              </div>
            )}
          </div>
          {description ? (
            <p className="text-sm text-[--muted] mt-1.5">{description}</p>
          ) : null}
        </div>
      )}

      {preview?.error ? (
        <p className="text-xs text-red-400">{preview.error}</p>
      ) : (
        <FormatterPreviewBox
          compact
          className="text-sm"
          name={preview?.name}
          description={preview?.description}
        />
      )}

      {actions ? <div className="mt-auto pt-1">{actions}</div> : null}
    </GlowCard>
  );
}
