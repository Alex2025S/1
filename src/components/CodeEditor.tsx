import React, { useRef } from 'react';

interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  minRows?: number;
  highlightLines?: number[];
  ariaLabel?: string;
}

export function CodeEditor({
  value,
  onChange,
  placeholder = '# Вставте або напишіть ваш Python-код тут...',
  minRows = 12,
  highlightLines = [],
  ariaLabel = 'Редактор коду Python',
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lines = value.split('\n');
  const lineCount = Math.max(lines.length, minRows);
  const highlightedSet = new Set(highlightLines);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const nextValue = value.substring(0, start) + '    ' + value.substring(end);
      onChange(nextValue);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 4;
          textareaRef.current.selectionEnd = start + 4;
        }
      });
    }
  };

  return (
    <div className="relative flex overflow-hidden rounded-xl border border-slate-800 bg-slate-950 font-mono text-[13px] leading-6 text-slate-100">
      <div
        className="select-none border-r border-slate-800/90 bg-slate-900/70 py-3.5 pl-3 pr-2.5 text-right text-xs leading-6 text-slate-500 tabular-nums"
        aria-hidden="true"
      >
        {Array.from({ length: lineCount }, (_, idx) => {
          const lineNum = idx + 1;
          const isFlagged = highlightedSet.has(lineNum);
          return (
            <div
              key={lineNum}
              className={isFlagged ? 'font-semibold text-rose-400' : ''}
            >
              {lineNum}
            </div>
          );
        })}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={lineCount}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="code-editor w-full resize-y bg-transparent py-3.5 px-4 font-mono text-[13px] leading-6 text-slate-100 placeholder:text-slate-600 focus:outline-none"
      />
    </div>
  );
}
