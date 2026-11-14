import type { ComponentPropsWithRef } from 'react';

export function DragHandle({
  label,
  ...props
}: ComponentPropsWithRef<'button'> & { label: string }) {
  return (
    <button
      {...props}
      type="button"
      aria-label={label}
      title={label}
      className="w-6 min-h-9 shrink-0 self-stretch cursor-move touch-none rounded-full bg-[--muted] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 md:bg-[--subtle] md:hover:bg-[--subtle-highlight]"
    />
  );
}
