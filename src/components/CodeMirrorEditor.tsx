import React, { useMemo, useRef, useEffect } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
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
  onChange: (value: string) => void;
  onShortcut: (commandId: CommandId) => void;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  value,
  language,
  isDark,
  autoFocus = true,
  placeholder,
  onChange,
  onShortcut,
}) => {
  const cmRef = useRef<ReactCodeMirrorRef | null>(null);
  const onShortcutRef = useRef(onShortcut);
  onShortcutRef.current = onShortcut;

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

    return [langExt, androidKeymap, ...wrappingExt];
  }, [language]);

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
