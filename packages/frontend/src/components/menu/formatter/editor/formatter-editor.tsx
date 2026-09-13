import React, { useMemo, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import {
  EditorView,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { cn } from '@/components/ui/core/styling';
import { formatterTheme } from './formatter-theme';
import { formatterHighlight } from './formatter-highlight';
import { formatterLinter } from './formatter-lint';
import { formatterCompletion } from './formatter-complete';

export interface FormatterEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  initialHeight?: string;
  minHeight?: string;
  onFocusView?: (view: EditorView) => void;
  onViewReady?: (view: EditorView) => void;
}

export function FormatterEditor({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  initialHeight = '11rem',
  minHeight = '6rem',
  onFocusView,
  onViewReady,
}: FormatterEditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const onFocusRef = useRef(onFocusView);
  onFocusRef.current = onFocusView;

  const extensions = useMemo(
    () => [
      formatterHighlight,
      formatterLinter,
      formatterCompletion,
      EditorView.lineWrapping,
      placeholderExtension(placeholder ?? ''),
      EditorView.domEventHandlers({
        focus: (_event, view) => {
          onFocusRef.current?.(view);
          return false;
        },
      }),
    ],
    [placeholder]
  );

  return (
    <div
      className={cn(
        'overflow-hidden rounded-[--radius] border border-[--border] bg-[--paper]',
        className
      )}
      style={{ height: initialHeight, minHeight, resize: 'vertical' }}
    >
      <CodeMirror
        ref={ref}
        value={value}
        onChange={onValueChange}
        onCreateEditor={(view) => onViewReady?.(view)}
        editable={!disabled}
        theme={formatterTheme}
        indentWithTab={false}
        height="100%"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          autocompletion: false,
          bracketMatching: true,
          closeBrackets: true,
          searchKeymap: false,
          highlightSelectionMatches: false,
          indentOnInput: false,
          drawSelection: false,
        }}
        extensions={extensions}
      />
    </div>
  );
}
