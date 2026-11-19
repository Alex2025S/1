import { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  FileSearch,
  MessageSquareQuote,
  ShieldAlert,
} from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { PLAGIARISM_SAMPLE_AI, PLAGIARISM_SAMPLE_HUMAN } from '../lib/presets';
import type { PlagiarismAnalysisResult } from '../types';

interface PlagiarismViewProps {
  studentName: string;
  studentGroup: string;
  code: string;
  onCodeChange: (next: string) => void;
  taskDescription: string;
  onTaskDescriptionChange: (next: string) => void;
  onRequestAppendDoc: (title: string, content: string) => void;
}

export function PlagiarismView({
  studentName,
  studentGroup,
  code,
  onCodeChange,
  taskDescription,
  onTaskDescriptionChange,
  onRequestAppendDoc,
}: PlagiarismViewProps) {
  const [result, setResult] = useState<PlagiarismAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!code.trim()) {
      setErrorMsg('Вставте фрагмент коду Python для перевірки.');
      return;
    }
    setErrorMsg(null);
    setIsAnalyzing(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch('/api/plagiarism/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          studentName,
          studentGroup,
          code,
          taskDescription,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { analysis?: PlagiarismAnalysisResult; error?: string };
      if (!res.ok || !data.analysis) {
        throw new Error(data.error || 'Не вдалося виконати аналіз коду.');
      }
      setResult(data.analysis);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Час очікування перевірки вичерпано. Спробуйте повторити запит.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Помилка перевірки на плагіат.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsAnalyzing(false);
    }
  };

  const flaggedLines: number[] = [];
  if (result) {
    for (const frag of result.flaggedFragments) {
      for (let line = frag.lineStart; line <= frag.lineEnd; line++) {
        flaggedLines.push(line);
      }
    }
  }

  const handleSaveToDoc = () => {
    if (!result) return;
    const block = [
      `Звіт перевірки академічної доброчесності (Антиплагіат ШІ)`,
      `Учень: ${studentName} (${studentGroup})`,
      `Ймовірність генерації ШІ: ${result.aiProbability}% (${result.verdictLabel})`,
      `Висновок: ${result.summary}`,
      result.oralCheckQuestions.length > 0
        ? `Контрольні запитання для усної перевірки:\n${result.oralCheckQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    onRequestAppendDoc('Запис звіту антиплагіату в Google Docs', block);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
      {/* Left: Code Submission */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Аналізатор ШІ-фрагментів у коді</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Виявлення патернів LLM (ChatGPT / Copilot) для забезпечення академічної доброчесності
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onCodeChange(PLAGIARISM_SAMPLE_HUMAN);
                setResult(null);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              Приклад: учень
            </button>
            <button
              type="button"
              onClick={() => {
                onCodeChange(PLAGIARISM_SAMPLE_AI);
                setResult(null);
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              Приклад: ШІ-код
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="plag-task-desc" className="block text-xs font-medium text-slate-600 mb-1.5">
            Назва або умова завдання (допомагає оцінити відповідність рівню учня)
          </label>
          <input
            id="plag-task-desc"
            type="text"
            value={taskDescription}
            onChange={(e) => onTaskDescriptionChange(e.target.value)}
            placeholder="Напр.: Знайти найбільше число у списку без використання max()"
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
          />
        </div>

        <CodeEditor
          value={code}
          onChange={onCodeChange}
          minRows={13}
          highlightLines={flaggedLines}
          ariaLabel="Код Python для перевірки на плагіат"
        />

        {errorMsg && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">
            {errorMsg}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-slate-500">
            Результат автоматично потрапить у таблицю вчителя
          </span>
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <FileSearch className="h-4 w-4" />
            <span>{isAnalyzing ? 'Перевіряю стилометрію...' : 'Перевірити на ШІ-плагіат'}</span>
          </button>
        </div>
      </div>

      {/* Right: Forensic Report */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 lg:col-span-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3.5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Висновок щодо авторства</h3>
            <p className="text-xs text-slate-500">Стилометрія коду та підозрілі фрагменти</p>
          </div>
          {result && (
            <button
              type="button"
              onClick={handleSaveToDoc}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-700" />
              <span>У Google Docs</span>
            </button>
          )}
        </div>

        {!result ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center space-y-2">
            <ShieldAlert className="mx-auto h-8 w-8 text-slate-400" />
            <p className="text-sm font-medium text-slate-700">Звіт ще не сформовано</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
              Вставте код зліва або оберіть один із тестових прикладів, щоб перевірити наявність фрагментів, згенерованих ШІ, та отримати запитання для усної перевірки учня.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Probability Header */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {result.verdict === 'human' ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                  ) : result.verdict === 'mixed' ? (
                    <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-rose-600 shrink-0" />
                  )}
                  <span className="text-sm font-semibold text-slate-900">{result.verdictLabel}</span>
                </div>
                <span className="font-mono text-lg font-bold text-slate-900 tabular-nums">
                  {result.aiProbability}% ШІ
                </span>
              </div>

              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    result.aiProbability >= 65
                      ? 'bg-rose-600'
                      : result.aiProbability >= 35
                        ? 'bg-amber-500'
                        : 'bg-emerald-600'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(4, result.aiProbability))}%` }}
                />
              </div>

              <p className="text-sm leading-relaxed text-slate-700">{result.summary}</p>
            </div>

            {/* Flagged Fragments */}
            <div className="space-y-2.5">
              <h4 className="text-xs font-semibold text-slate-700">
                Виявлені підозрілі фрагменти ({result.flaggedFragments.length})
              </h4>

              {result.flaggedFragments.length === 0 ? (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900">
                  Характерних ШІ-шаблонів у фрагментах коду не виявлено.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {result.flaggedFragments.map((frag, idx) => (
                    <div key={idx} className="rounded-xl border border-rose-200/80 bg-rose-50/40 p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-rose-800 tabular-nums">
                          Рядки {frag.lineStart}–{frag.lineEnd}
                        </span>
                        <span className="text-rose-700 font-medium">
                          Впевненість:{' '}
                          {frag.confidence === 'high'
                            ? 'Висока'
                            : frag.confidence === 'medium'
                              ? 'Середня'
                              : 'Низька'}
                        </span>
                      </div>
                      <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-mono text-xs text-slate-100">
                        <code>{frag.codeFragment}</code>
                      </pre>
                      <p className="text-xs leading-relaxed text-slate-700">{frag.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Student Signals */}
            {result.studentSignals.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-700">Ознаки самостійної роботи</h4>
                <ul className="space-y-1.5">
                  {result.studentSignals.map((sig, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                      <span>{sig}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Oral Verification Questions */}
            {result.oralCheckQuestions.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                  <MessageSquareQuote className="h-4 w-4 text-blue-700" />
                  <span>Запитання для усної перевірки авторства учня</span>
                </div>
                <ol className="space-y-1.5">
                  {result.oralCheckQuestions.map((q, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-slate-700">
                      <span className="font-mono font-semibold text-blue-700 tabular-nums">{idx + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
