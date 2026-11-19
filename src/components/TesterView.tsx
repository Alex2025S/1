import { useState } from 'react';
import {
  Award,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type {
  DifficultyLevel,
  TestEvaluationResult,
  TestTask,
  WorkspaceDocInfo,
} from '../types';

interface TesterViewProps {
  studentName: string;
  studentGroup: string;
  linkedDoc: WorkspaceDocInfo | null;
  onRequestAppendDoc: (title: string, content: string) => void;
  onOpenWorkspaceModal: () => void;
}

const DIFFICULTY_CARDS: Array<{
  id: DifficultyLevel;
  title: string;
  subtitle: string;
  topics: string;
}> = [
  {
    id: 'beginner',
    title: 'Початковий рівень',
    subtitle: 'Перші кроки в Python',
    topics: 'Змінні, типи int/str, умови if/else, прості цикли for та while',
  },
  {
    id: 'intermediate',
    title: 'Середній рівень',
    subtitle: 'Впевнена практика',
    topics: 'Функції def, списки, зрізи, словники, логічні помилки в циклах',
  },
  {
    id: 'advanced',
    title: 'Просунутий рівень',
    subtitle: 'Поглиблений дебагінг',
    topics: 'Рекурсія, складні структури даних, генератори, алгоритмічні крайні випадки',
  },
];

const TASK_TYPE_LABELS: Record<TestTask['type'], string> = {
  find_bug: 'Знайдіть помилку в коді',
  predict_output: 'Передбачте результат виконання',
  fix_logic: 'Запропонуйте виправлення логіки',
};

export function TesterView({
  studentName,
  studentGroup,
  linkedDoc,
  onRequestAppendDoc,
  onOpenWorkspaceModal,
}: TesterViewProps) {
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('beginner');
  const [topic, setTopic] = useState('Цикли, списки та базовий дебагінг');
  const [useLinkedDoc, setUseLinkedDoc] = useState(false);
  const [questionCount, setQuestionCount] = useState(4);

  const [tasks, setTasks] = useState<TestTask[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  const [evaluation, setEvaluation] = useState<TestEvaluationResult | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGenerateTest = async () => {
    setErrorMsg(null);
    setEvaluation(null);
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch('/api/tester/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          difficulty,
          topic,
          questionCount,
          docContext: useLinkedDoc && linkedDoc?.plainText ? linkedDoc.plainText : '',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { tasks?: TestTask[]; error?: string };
      if (!res.ok || !data.tasks || data.tasks.length === 0) {
        throw new Error(data.error || 'Не вдалося згенерувати завдання.');
      }
      setTasks(data.tasks);
      setAnswers({});
      setRevealedHints({});
      setActiveIndex(0);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Час очікування генерації вичерпано. Спробуйте ще раз.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Помилка генерації тесту.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsGenerating(false);
    }
  };

  const handleEvaluateTest = async () => {
    setErrorMsg(null);
    setIsEvaluating(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch('/api/tester/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          studentName,
          studentGroup,
          difficulty,
          topic,
          tasks,
          answers,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { evaluation?: TestEvaluationResult; error?: string };
      if (!res.ok || !data.evaluation) {
        throw new Error(data.error || 'Не вдалося оцінити відповіді.');
      }
      setEvaluation(data.evaluation);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMsg('Час очікування перевірки вичерпано. Спробуйте ще раз.');
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Помилка перевірки тесту.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsEvaluating(false);
    }
  };

  const handleSaveReportToDoc = () => {
    if (!evaluation) return;
    const diffLabel = DIFFICULTY_CARDS.find((d) => d.id === difficulty)?.title ?? difficulty;
    const text = [
      `Результати тестування знань Python`,
      `Учень: ${studentName} (${studentGroup})`,
      `Тема: ${topic} · Рівень: ${diffLabel}`,
      `Оцінка: ${evaluation.score12}/12 балів (${evaluation.percentage}%)`,
      `Загальний висновок: ${evaluation.overallVerdict}`,
      `Рекомендації:\n${evaluation.recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
    ].join('\n\n');

    onRequestAppendDoc('Збереження оцінки та рекомендацій у Google Docs', text);
  };

  // Setup View
  if (tasks.length === 0) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Режим тестувальника знань Python</h2>
              <p className="mt-1 text-sm text-slate-600">
                Оберіть рівень складності та тему. Після виконання завдань ви отримаєте оцінку за 12-бальною шкалою та персональні рекомендації.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenWorkspaceModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-700" />
              <span>{linkedDoc ? `Docs: ${linkedDoc.title}` : 'Підключити Google Docs'}</span>
            </button>
          </div>

          {/* 3 Difficulty Levels */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-3">1. Оберіть рівень складності</p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {DIFFICULTY_CARDS.map((card) => {
                const isSelected = difficulty === card.id;
                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setDifficulty(card.id)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      isSelected
                        ? 'border-blue-700 bg-blue-50/70'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-900">{card.title}</span>
                      {isSelected && <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-700" />}
                    </div>
                    <p className="mt-1 text-xs font-medium text-blue-800">{card.subtitle}</p>
                    <p className="mt-2 text-xs leading-relaxed text-slate-600">{card.topics}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Topic & Options */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
            <div className="md:col-span-8">
              <label htmlFor="tester-topic" className="block text-xs font-semibold text-slate-700 mb-1.5">
                2. Тема для закріплення матеріалу
              </label>
              <input
                id="tester-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Напр.: Цикли for, словники, рекурсія..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="md:col-span-4">
              <label htmlFor="tester-count" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Кількість завдань
              </label>
              <select
                id="tester-count"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
              >
                <option value={3}>3 завдання (експрес)</option>
                <option value={4}>4 завдання (стандарт)</option>
                <option value={5}>5 завдань (повний)</option>
              </select>
            </div>
          </div>

          {linkedDoc && (
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={useLinkedDoc}
                onChange={(e) => setUseLinkedDoc(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span>
                Згенерувати завдання на основі матеріалу з підключеного Google Документа («{linkedDoc.title}»)
              </span>
            </label>
          )}

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {errorMsg}
            </div>
          )}

          <div className="flex items-center justify-end pt-2">
            <button
              type="button"
              onClick={() => void handleGenerateTest()}
              disabled={isGenerating}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-4 w-4" />
              <span>{isGenerating ? 'Формую завдання...' : 'Розпочати тестування'}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Evaluation Result View
  if (evaluation) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 text-blue-700">
                <Award className="h-7 w-7" />
              </div>
              <div>
                <p className="text-xs text-slate-500">
                  {studentName} · {topic} ·{' '}
                  {DIFFICULTY_CARDS.find((d) => d.id === difficulty)?.title}
                </p>
                <h2 className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">
                  Оцінка: {evaluation.score12} / 12 балів ({evaluation.percentage}%)
                </h2>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleSaveReportToDoc}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <BookOpen className="h-3.5 w-3.5 text-blue-700" />
                <span>Записати у Google Docs</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setTasks([]);
                  setEvaluation(null);
                }}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
              >
                Пройти новий тест
              </button>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-slate-700">{evaluation.overallVerdict}</p>

          {/* Recommendations */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Рекомендації для закріплення матеріалу
            </h3>
            <ul className="space-y-2">
              {evaluation.recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2.5 text-sm text-slate-700">
                  <span className="font-mono text-xs font-semibold text-blue-700 tabular-nums mt-0.5">
                    0{idx + 1}.
                  </span>
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Per Task Breakdown */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">Детальний розбір відповідей</h3>
            {tasks.map((task, idx) => {
              const fb = evaluation.perTaskFeedback.find((f) => f.taskId === task.id) ?? evaluation.perTaskFeedback[idx];
              return (
                <div key={task.id} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {fb?.isCorrect ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-600 shrink-0" />
                      )}
                      <span className="text-sm font-semibold text-slate-900">
                        Завдання {idx + 1}: {task.title}
                      </span>
                    </div>
                    {fb && (
                      <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                        {fb.score} / {fb.maxScore} балів
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-slate-500">
                    Ваша відповідь: <span className="text-slate-800">{answers[task.id] || 'не надано'}</span>
                  </p>
                  {fb && (
                    <>
                      <p className="text-sm text-slate-700">{fb.explanation}</p>
                      <p className="text-xs text-emerald-800">
                        <strong className="font-semibold">Краща практика: </strong>
                        {fb.bestPractice}
                      </p>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Active Quiz Runner
  const currentTask = tasks[activeIndex];
  const currentAnswer = answers[currentTask.id] ?? '';
  const answeredCount = tasks.filter((t) => (answers[t.id] ?? '').trim().length > 0).length;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Progress Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-900 tabular-nums">
            Завдання {activeIndex + 1} з {tasks.length}
          </span>
          <span aria-hidden="true">·</span>
          <span>{TASK_TYPE_LABELS[currentTask.type] || currentTask.expectedConcept}</span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">Відповідей: {answeredCount}/{tasks.length}</span>
        </div>

        <div className="flex items-center gap-1.5">
          {tasks.map((t, idx) => {
            const isFilled = (answers[t.id] ?? '').trim().length > 0;
            const isCurrent = idx === activeIndex;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`h-8 w-8 rounded-lg font-mono text-xs font-semibold tabular-nums transition-colors ${
                  isCurrent
                    ? 'bg-blue-700 text-white'
                    : isFilled
                      ? 'border border-emerald-300 bg-emerald-50 text-emerald-800'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current Task Card */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-blue-700">{currentTask.expectedConcept}</p>
              <h3 className="text-lg font-semibold text-slate-900 mt-0.5">{currentTask.title}</h3>
            </div>
            <button
              type="button"
              onClick={() =>
                setRevealedHints((prev) => ({ ...prev, [currentTask.id]: !prev[currentTask.id] }))
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <HelpCircle className="h-3.5 w-3.5 text-amber-600" />
              <span>Підказка</span>
            </button>
          </div>

          <p className="text-sm leading-relaxed text-slate-700">{currentTask.prompt}</p>

          <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[13px] leading-6 text-slate-100">
            <code>{currentTask.codeSnippet}</code>
          </pre>

          {revealedHints[currentTask.id] && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              <strong className="font-semibold">Підказка: </strong>
              {currentTask.hint}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 space-y-4 lg:col-span-6">
          <div className="space-y-2 flex-1 flex flex-col">
            <label htmlFor="quiz-answer-box" className="text-sm font-semibold text-slate-900">
              Ваша відповідь або пояснення виправлення
            </label>
            <textarea
              id="quiz-answer-box"
              value={currentAnswer}
              onChange={(e) =>
                setAnswers((prev) => ({ ...prev, [currentTask.id]: e.target.value }))
              }
              rows={9}
              placeholder="Опишіть знайдену помилку, очікуваний вивід або потрібну зміну в логіці..."
              className="w-full flex-1 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 font-mono text-sm text-slate-900 placeholder:font-sans placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-800">
              {errorMsg}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setTasks([]);
                setEvaluation(null);
              }}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Скасувати тест
            </button>

            <div className="flex items-center gap-2">
              {activeIndex < tasks.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setActiveIndex((i) => Math.min(tasks.length - 1, i + 1))}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                >
                  <span>Наступне</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => void handleEvaluateTest()}
                disabled={isEvaluating}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>{isEvaluating ? 'Перевіряю...' : 'Завершити та оцінити'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
