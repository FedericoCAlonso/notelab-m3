import React, { useMemo, useRef, useEffect } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { autocompletion, CompletionSource } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { CommandId } from '../commands/CommandRegistry';

interface CodeMirrorEditorProps {
  value: string;
  language: 'markdown' | 'python';
  isDark: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  completionSource?: CompletionSource | null;
  onChange: (value: string) => void;
  onShortcut: (commandId: CommandId) => void;
  onPasteImage?: (file: File) => void;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  language,
  isDark,
  autoFocus = true,
  placeholder,
  completionSource = null,
  onChange,
  onShortcut,
  onPasteImage,
}) => {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;
  const onPasteImageRef = useRef(onPasteImage);
  onPasteImageRef.current = onPasteImage;
  const completionSourceRef = useRef(completionSource);
  completionSourceRef.current = completionSource;

  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => {
      const view = cmRef.current?.view;
      if (view) {
        view.focus();
      }
    }, 20);
    return () => clearTimeout(timer);
  }, [autoFocus]);

  const extensions = useMemo(() => {
    const langExt = language === 'python' ? python() : markdown();

    const trigger = (id: CommandId) => () => {
      onShortcutRef.current(id);
      return true;
    };

    const androidKeymap = Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run: trigger('cell.runAndStay') },
        { key: 'Ctrl-Enter', run: trigger('cell.runAndStay') },
        { key: 'Shift-Enter', run: trigger('cell.runAndAdvance') },
        { key: 'Alt-ArrowUp', run: trigger('cell.moveUp') },
        { key: 'Alt-ArrowDown', run: trigger('cell.moveDown') },
        { key: 'Mod-b', run: trigger('cell.insertBelow') },
        { key: 'Ctrl-b', run: trigger('cell.insertBelow') },
        { key: 'Mod-m', run: trigger('cell.toggleType') },
        { key: 'Ctrl-m', run: trigger('cell.toggleType') },
        { key: 'Mod-h', run: trigger('cell.toggleHideSource') },
        { key: 'Ctrl-h', run: trigger('cell.toggleHideSource') },
        { key: 'Mod-s', run: trigger('notebook.forceSync') },
        { key: 'Ctrl-s', run: trigger('notebook.forceSync') },
        { key: 'Mod-/', run: trigger('app.openShortcuts') },
        { key: 'Ctrl-/', run: trigger('app.openShortcuts') },
      ])
    );

    const wrappingExt =
      language === 'markdown' ? [EditorView.lineWrapping] : [];

    const pasteHandlerExt = EditorView.domEventHandlers({
      paste(event) {
        if (language !== 'markdown' || !onPasteImageRef.current) return false;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              onPasteImageRef.current(file);
              return true;
            }
          }
        }
        return false;
      },
    });

    const customCompletionExt = completionSource
      ? [
          autocompletion({
            override: [
              (ctx) => completionSourceRef.current?.(ctx) ?? null,
            ],
            activateOnTyping: true,
          }),
        ]
      : [];

    return [langExt, androidKeymap, pasteHandlerExt, ...customCompletionExt, ...wrappingExt];
  }, [language, Boolean(completionSource)]);

  return (
    <div className="notelab-cm w-full rounded-xl bg-surface-container-lowest/70 border border-outline-variant/60 px-1 py-0.5">
      <CodeMirror
        ref={cmRef}
        value={value}
        height="auto"
        minHeight="68px"
        theme={isDark ? oneDark : 'light'}
        extensions={extensions}
        placeholder={placeholder}
        onChange={onChange}
        basicSetup={{
          lineNumbers: language === 'python',
          foldGutter: false,
          highlightActiveLineGutter: false,
          highlightActiveLine: true,
          autocompletion: true,
          bracketMatching: true,
          closeBrackets: true,
          indentOnInput: true,
          tabSize: 4,
        }}
      />
    </div>
  );
};
