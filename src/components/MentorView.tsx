import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  BugPlay,
  FileText,
  Lightbulb,
  RotateCcw,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { MarkdownText } from './MarkdownText';
import { MENTOR_STARTER_PRESETS } from '../lib/presets';
import type { ChatMessage, WorkspaceDocInfo } from '../types';

interface MentorViewProps {
  studentName: string;
  studentGroup: string;
  code: string;
  onCodeChange: (next: string) => void;
  taskContext: string;
  onTaskContextChange: (next: string) => void;
  linkedDoc: WorkspaceDocInfo | null;
  onSendToPlagiarism: (code: string, taskContext: string) => void;
  onRequestAppendDoc: (title: string, content: string) => void;
  onOpenWorkspaceModal: () => void;
}

export function MentorView({
  studentName,
  studentGroup,
  code,
  onCodeChange,
  taskContext,
  onTaskContextChange,
  linkedDoc,
  onSendToPlagiarism,
  onRequestAppendDoc,
  onOpenWorkspaceModal,
}: MentorViewProps) {
  const [errorLog, setErrorLog] = useState(MENTOR_STARTER_PRESETS[0].errorLog);
  const [questionInput, setQuestionInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'mentor',
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
      content:
        'Вітаю! Я твій ментор з дебагінгу Python. Встав свій код зліва, додай текст помилки (якщо є) і натисни **«Проаналізувати з ментором»**. Я поясню логіку проблеми, пораджу найкращі практики та дам спрямовуючу підказку — але готовий код ти напишеш самостійно.',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const applyPreset = (presetId: string) => {
    const found = MENTOR_STARTER_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    onCodeChange(found.code);
    setErrorLog(found.errorLog);
    onTaskContextChange(`${found.title} (${found.topic})`);
    setQuestionInput(found.studentQuestion);
    setApiError(null);
  };

  const sendToMentor = async (customMessage?: string) => {
    const outgoing = (customMessage ?? questionInput).trim() || 'Проаналізуй мій код і підкажи, де логічна чи синтаксична помилка.';
    if (!code.trim() && !outgoing) return;

    setApiError(null);
    const userMsg: ChatMessage = {
      id: `m_u_${Date.now()}`,
      role: 'student',
      content: outgoing,
      timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    if (!customMessage) setQuestionInput('');
    setIsLoading(true);

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 22000);

    try {
      const historyPayload = messages
        .filter((m) => m.id !== 'welcome')
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch('/api/mentor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          studentName,
          studentGroup,
          code,
          errorLog,
          taskContext,
          history: historyPayload,
          message: outgoing,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        meta?: { errorType?: string; detectedConcept?: string; bestPracticeTip?: string };
        error?: string;
      };

      if (!res.ok || !data.reply) {
        throw new Error(data.error || 'Не вдалося отримати відповідь ментора.');
      }

      const mentorMsg: ChatMessage = {
        id: `m_a_${Date.now()}`,
        role: 'mentor',
        content: data.reply,
        timestamp: new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
        meta: data.meta,
      };
      setMessages((prev) => [...prev, mentorMsg]);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setApiError('Час очікування відповіді вичерпано. Спробуйте натиснути «Проаналізувати з ментором» ще раз.');
      } else {
        setApiError(err instanceof Error ? err.message : 'Помилка зв’язку з сервером.');
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsLoading(false);
    }
  };

  const handleSaveLastHintToDoc = () => {
    const lastMentor = [...messages].reverse().find((m) => m.role === 'mentor' && m.id !== 'welcome');
    if (!lastMentor) return;
    const summaryBlock = [
      `Учень: ${studentName} (${studentGroup})`,
      taskContext ? `Завдання: ${taskContext}` : '',
      `Код учня:\n${code}`,
      `Підказка ментора:\n${lastMentor.content}`,
      lastMentor.meta?.bestPracticeTip ? `Найкраща практика: ${lastMentor.meta.bestPracticeTip}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    onRequestAppendDoc('Запис менторської сесії Python у Google Docs', summaryBlock);
  };

  const hasMentorReply = messages.some((m) => m.role === 'mentor' && m.id !== 'welcome');

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-stretch">
      {/* Left Zone: Interactive Python Code Stage */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Робоче поле коду Python</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Редагуйте код, додайте помилку з консолі та отримайте спрямовуючий розбір
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="preset-select" className="sr-only">
              Приклади завдань
            </label>
            <select
              id="preset-select"
              onChange={(e) => {
                if (e.target.value) applyPreset(e.target.value);
              }}
              defaultValue="index_loop"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 focus:border-blue-600 focus:outline-none"
            >
              {MENTOR_STARTER_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  Приклад: {preset.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onOpenWorkspaceModal}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <FileText className="h-3.5 w-3.5 text-blue-700" />
              <span>{linkedDoc ? 'Імпорт з Docs' : 'Підключити Docs'}</span>
            </button>
          </div>
        </div>

        {/* Task Context */}
        <div>
          <label htmlFor="task-context-input" className="block text-xs font-medium text-slate-600 mb-1.5">
            Умова завдання або контекст уроку (необов’язково)
          </label>
          <input
            id="task-context-input"
            type="text"
            value={taskContext}
            onChange={(e) => onTaskContextChange(e.target.value)}
            placeholder="Напр.: Порахувати середній бал елементів списку..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
          />
        </div>

        {/* Python Code Editor */}
        <CodeEditor value={code} onChange={onCodeChange} minRows={11} />

        {/* Traceback / Expected vs Actual */}
        <div>
          <label htmlFor="error-log-input" className="block text-xs font-medium text-slate-600 mb-1.5">
            Текст помилки Python (Traceback) або очікуваний результат
          </label>
          <textarea
            id="error-log-input"
            value={errorLog}
            onChange={(e) => setErrorLog(e.target.value)}
            rows={2}
            placeholder="Напр.: IndexError: list index out of range або несподіваний вивід..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
          />
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void sendToMentor()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <BugPlay className="h-4 w-4" />
              <span>{isLoading ? 'Аналізую код...' : 'Проаналізувати з ментором'}</span>
            </button>

            <button
              type="button"
              onClick={() => onSendToPlagiarism(code, taskContext)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-amber-600" />
              <span>Перевірити на ШІ-плагіат</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMessages((prev) => [prev[0]]);
              setApiError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Очистити чат</span>
          </button>
        </div>
      </div>

      {/* Right Zone: Real-Time Socratic Mentor Chat */}
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white lg:col-span-5 lg:h-[670px]">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Менторський розбір</h3>
            <p className="text-xs text-slate-500">Пояснення логіки без готових відповідей</p>
          </div>

          {hasMentorReply && (
            <button
              type="button"
              onClick={handleSaveLastHintToDoc}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <BookOpen className="h-3.5 w-3.5 text-blue-700" />
              <span>У Google Docs</span>
            </button>
          )}
        </div>

        {/* Messages Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.filter((m) => m.content.trim().length > 0).map((msg) => {
            const isStudent = msg.role === 'student';
            return (
              <div
                key={msg.id}
                className={`rounded-xl border p-4 ${
                  isStudent
                    ? 'ml-6 border-blue-200 bg-blue-50/70'
                    : 'mr-2 border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-800">
                    {isStudent ? studentName : 'Ментор Python'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{msg.timestamp}</span>
                  {msg.meta?.errorType && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-amber-700">{msg.meta.errorType}</span>
                    </>
                  )}
                  {msg.meta?.detectedConcept && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-slate-600">{msg.meta.detectedConcept}</span>
                    </>
                  )}
                </div>

                <MarkdownText text={msg.content} />

                {msg.meta?.bestPracticeTip && (
                  <div className="mt-3 flex items-start gap-2 border-t border-slate-200/80 pt-2.5 text-xs text-slate-700">
                    <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                    <span>
                      <strong className="font-semibold text-slate-900">Краща практика: </strong>
                      {msg.meta.bestPracticeTip}
                    </span>
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && !messages[messages.length - 1]?.content && (
            <div className="mr-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Ментор вивчає ваш код та готує підказку...
            </div>
          )}

          {apiError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              {apiError}
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Quick Socratic Prompts & Composer */}
        <div className="border-t border-slate-200 p-4 space-y-2.5 bg-slate-50/40">
          <div className="flex flex-wrap gap-1.5">
            {[
              'Перевір моє виправлення в коді',
              'Дай ще меншу підказку',
              'Яка тут найкраща практика PEP 8?',
            ].map((quick) => (
              <button
                key={quick}
                type="button"
                disabled={isLoading}
                onClick={() => void sendToMentor(quick)}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-blue-800 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {quick}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e: React.FormEvent) => {
              e.preventDefault();
              void sendToMentor();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="Поставте уточнююче запитання ментору..."
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isLoading}
              aria-label="Надіслати запитання"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60 transition-colors"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
