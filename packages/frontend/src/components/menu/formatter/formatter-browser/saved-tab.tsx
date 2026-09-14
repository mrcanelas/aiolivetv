import React, { useEffect, useMemo, useState } from 'react';
import { Bookmark, BookmarkPlus, Pencil, Trash2 } from 'lucide-react';
import { LuCheck, LuX } from 'react-icons/lu';
import type { FormatterDefinition } from '../../../../../../core/src/utils/formatter-definitions';
import { Button, IconButton } from '../../../ui/button';
import { Popover } from '../../../ui/popover';
import { TextInput } from '../../../ui/text-input';
import { Tooltip } from '../../../ui/tooltip';
import {
  ConfirmationDialog,
  useConfirmationDialog,
} from '../../../shared/confirmation-dialog';
import { FormatterCard } from './formatter-card';
import type { CardPreview } from './use-card-previews';

export interface SavedTabProps {
  saved: Record<string, FormatterDefinition>;
  previews: Record<string, CardPreview>;
  activeName?: string;
  onSelect: (name: string) => void;
  onSaveCurrent: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}

export function SavedTab({
  saved,
  previews,
  activeName,
  onSelect,
  onSaveCurrent,
  onRename,
  onDelete,
}: SavedTabProps) {
  const names = useMemo(
    () => Object.keys(saved).sort((a, b) => a.localeCompare(b)),
    [saved]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-[--muted]">
          Saved formatters live in your config. Pick one to edit it in place.
        </p>
        <SaveCurrentPopover existing={names} onSave={onSaveCurrent} />
      </div>

      {names.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-700 px-6 py-10 text-center">
          <Bookmark className="mx-auto h-8 w-8 text-[--muted]" />
          <p className="mt-3 font-medium">No saved formatters yet</p>
          <p className="mt-1 text-sm text-[--muted]">
            Keep a named copy of the formatter in the editor so you can switch
            back to it later.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {names.map((name) => (
            <SavedCard
              key={name}
              name={name}
              existingNames={names}
              preview={previews[`saved:${name}`]}
              active={activeName === name}
              onSelect={onSelect}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SaveCurrentPopover({
  existing,
  onSave,
}: {
  existing: string[];
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const overwrites = trimmed.length > 0 && existing.includes(trimmed);

  const close = () => {
    setOpen(false);
    setName('');
  };
  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    close();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      align="end"
      className="w-80"
      trigger={
        <Button
          size="sm"
          intent="primary-subtle"
          leftIcon={<BookmarkPlus className="h-4 w-4" />}
        >
          Save current
        </Button>
      }
    >
      <p className="font-medium">Save current formatter</p>
      <p className="text-sm text-[--muted] mt-1 mb-3">
        Keeps a named copy of the templates in the editor.
      </p>
      <TextInput
        value={name}
        onValueChange={setName}
        placeholder="Name for this formatter"
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
        }}
      />
      {overwrites && (
        <p className="text-xs text-yellow-400 mt-2">
          Replaces the existing “{trimmed}”.
        </p>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button size="sm" intent="white" onClick={close}>
          Cancel
        </Button>
        <Button size="sm" intent="primary" disabled={!trimmed} onClick={save}>
          Save
        </Button>
      </div>
    </Popover>
  );
}

function SavedCard({
  name,
  existingNames,
  preview,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  name: string;
  existingNames: string[];
  preview?: CardPreview;
  active: boolean;
  onSelect: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onDelete: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  useEffect(() => {
    setDraft(name);
  }, [name]);

  const deleteDialog = useConfirmationDialog({
    title: 'Delete formatter',
    description: (
      <span className="break-all">
        Are you sure you want to delete “{name}”?
      </span>
    ),
    actionText: 'Delete',
    actionIntent: 'alert-subtle',
    onConfirm: () => onDelete(name),
  });

  const confirmRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      if (existingNames.includes(trimmed)) return;
      onRename(name, trimmed);
    } else {
      setDraft(name);
    }
    setEditing(false);
  };

  const cancelRename = () => {
    setDraft(name);
    setEditing(false);
  };

  const duplicate =
    editing && draft.trim() !== name && existingNames.includes(draft.trim());

  return (
    <>
      <ConfirmationDialog {...deleteDialog} />
      <FormatterCard
        active={active}
        preview={preview}
        badge={
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
            Saved
          </span>
        }
        header={
          editing ? (
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <TextInput
                  value={draft}
                  onValueChange={setDraft}
                  autoFocus
                  className="flex-1 min-w-0"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                />
                <IconButton
                  size="sm"
                  rounded
                  intent="primary-subtle"
                  disabled={duplicate}
                  icon={<LuCheck className="h-3.5 w-3.5" />}
                  onClick={confirmRename}
                />
                <IconButton
                  size="sm"
                  rounded
                  intent="gray-subtle"
                  icon={<LuX className="h-3.5 w-3.5" />}
                  onClick={cancelRename}
                />
              </div>
              {duplicate && (
                <p className="text-xs text-red-400">
                  A saved formatter with this name already exists.
                </p>
              )}
            </div>
          ) : undefined
        }
        title={name}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              intent={active ? 'white' : 'primary-subtle'}
              onClick={() => onSelect(name)}
            >
              {active ? 'In use' : 'Use'}
            </Button>
            <div className="ml-auto flex gap-1">
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="gray-subtle"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setEditing(true)}
                  />
                }
              >
                Rename
              </Tooltip>
              <Tooltip
                trigger={
                  <IconButton
                    size="sm"
                    rounded
                    intent="alert-subtle"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={deleteDialog.open}
                  />
                }
              >
                Delete
              </Tooltip>
            </div>
          </div>
        }
      />
    </>
  );
}
