import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Search,
  Table2,
  Trash2,
} from 'lucide-react';
import type { TeacherLogEntry, WorkspaceSheetInfo } from '../types';

interface TeacherDashboardViewProps {
  logs: TeacherLogEntry[];
  streamConnected: boolean;
  linkedSheet: WorkspaceSheetInfo | null;
  onOpenWorkspaceModal: () => void;
  onRequestSyncToSheet: (entriesToSync: TeacherLogEntry[]) => void;
  onDeleteLog: (id: string) => Promise<void>;
}

const MODE_LABELS: Record<TeacherLogEntry['mode'], string> = {
  mentor: 'Ментор дебагінгу',
  tester: 'Тестувальник',
  plagiarism: 'Антиплагіат ШІ',
};

export function TeacherDashboardView({
  logs,
  streamConnected,
  linkedSheet,
  onOpenWorkspaceModal,
  onRequestSyncToSheet,
  onDeleteLog,
}: TeacherDashboardViewProps) {
  const [modeFilter, setModeFilter] = useState<'all' | TeacherLogEntry['mode']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((item) => {
      if (modeFilter !== 'all' && item.mode !== modeFilter) return false;
      if (!q) return true;
      return (
        item.studentName.toLowerCase().includes(q) ||
        item.studentGroup.toLowerCase().includes(q) ||
        item.topicOrAction.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q)
      );
    });
  }, [logs, modeFilter, searchQuery]);

  const stats = useMemo(() => {
    const uniqueStudents = new Set(logs.map((l) => l.studentName)).size;
    const mentorCount = logs.filter((l) => l.mode === 'mentor').length;
    const testerLogs = logs.filter((l) => l.mode === 'tester');
    const highRiskCount = logs.filter(
      (l) => l.mode === 'plagiarism' && (l.aiRiskPercent ?? 0) >= 60
    ).length;

    let avgScoreText = '—';
    if (testerLogs.length > 0) {
      const scores = testerLogs
        .map((l) => {
          const match = l.scoreOrResult.match(/^(\d+)\/12/);
          return match ? Number(match[1]) : null;
        })
        .filter((v): v is number => v !== null);
      if (scores.length > 0) {
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        avgScoreText = `${avg.toFixed(1)} / 12`;
      }
    }

    return {
      uniqueStudents,
      mentorCount,
      avgScoreText,
      highRiskCount,
    };
  }, [logs]);

  const unsyncedLogs = useMemo(() => logs.filter((l) => !l.syncedToSheets), [logs]);

  const handleDownloadCsv = () => {
    const headers = [
      'Час',
      'Учень',
      'Група',
      'Режим',
      'Тема / Дія',
      'Рівень',
      'Результат / Оцінка',
      'Ризик ШІ (%)',
      'Підсумок',
    ];
    const escapeCsv = (val: string) => `"${val.replace(/"/g, '""')}"`;
    const rows = filteredLogs.map((l) =>
      [
        new Date(l.timestamp).toLocaleString('uk-UA'),
        l.studentName,
        l.studentGroup,
        MODE_LABELS[l.mode],
        l.topicOrAction,
        l.difficultyLabel,
        l.scoreOrResult,
        l.aiRiskPercent !== null ? `${l.aiRiskPercent}%` : '',
        l.summary,
      ]
        .map(escapeCsv)
        .join(',')
    );
    const csv = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pymentor-teacher-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Учнів у системі</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.uniqueStudents}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Розборів у ментора</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.mentorCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Середній бал тестів</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.avgScoreText}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Підозр на ШІ-плагіат (≥60%)</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {stats.highRiskCount}
          </p>
        </div>
      </div>

      {/* Google Sheets Live Sync Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
            <Table2 className="h-4 w-4 text-emerald-700" />
            <span>
              {linkedSheet
                ? `Google Таблиця вчителя: «${linkedSheet.title}» (${linkedSheet.activeTab})`
                : 'Таблиця прогресу вчителя в реальному часі'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {streamConnected ? 'Живий потік подій активний' : 'Оновлення потоку...'}
            <span className="mx-1.5" aria-hidden="true">·</span>
            <span className="tabular-nums">Усього подій: {logs.length}</span>
            {linkedSheet && (
              <>
                <span className="mx-1.5" aria-hidden="true">·</span>
                <span className="tabular-nums">Очікують запису в Google Sheets: {unsyncedLogs.length}</span>
              </>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {linkedSheet ? (
            <>
              <button
                type="button"
                disabled={unsyncedLogs.length === 0}
                onClick={() => onRequestSyncToSheet(unsyncedLogs)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Table2 className="h-3.5 w-3.5" />
                <span>Записати в Google Таблицю ({unsyncedLogs.length})</span>
              </button>
              <a
                href={linkedSheet.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <span>Відкрити таблицю</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </>
          ) : (
            <button
              type="button"
              onClick={onOpenWorkspaceModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
            >
              <Table2 className="h-3.5 w-3.5" />
              <span>Підключити Google Таблицю</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleDownloadCsv}
            disabled={filteredLogs.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Експорт CSV</span>
          </button>
        </div>
      </div>

      {/* Filters & Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                { id: 'all', label: 'Усі дії' },
                { id: 'mentor', label: 'Ментор' },
                { id: 'tester', label: 'Тестувальник' },
                { id: 'plagiarism', label: 'Антиплагіат' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setModeFilter(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  modeFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Пошук за учнем або темою..."
              className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="px-6 py-12 text-center space-y-1.5">
            <p className="text-sm font-medium text-slate-700">
              {logs.length === 0
                ? 'Журнал активності учнів поки порожній'
                : 'За вашим фільтром записів не знайдено'}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              {logs.length === 0
                ? 'Щойно учень проаналізує код у Менторі, пройде тестування або перевірить роботу на ШІ-плагіат, результати миттєво з’являться у цій таблиці.'
                : 'Спробуйте змінити пошуковий запит або обрати вкладку «Усі дії».'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                  <th className="py-3 pl-5 pr-3 w-8" />
                  <th className="py-3 px-3 whitespace-nowrap">Час</th>
                  <th className="py-3 px-3 whitespace-nowrap">Учень</th>
                  <th className="py-3 px-3 whitespace-nowrap">Режим</th>
                  <th className="py-3 px-3">Тема або дія</th>
                  <th className="py-3 px-3 whitespace-nowrap">Результат</th>
                  <th className="py-3 px-3 whitespace-nowrap">Google Sheets</th>
                  <th className="py-3 pl-3 pr-5 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredLogs.map((entry) => {
                  const isExpanded = expandedId === entry.id;
                  return (
                    <React.Fragment key={entry.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                        className="cursor-pointer hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3 pl-5 pr-2 text-slate-400">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleTimeString('uk-UA', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-medium text-slate-900">{entry.studentName}</span>
                          <span className="ml-1.5 text-xs text-slate-500">· {entry.studentGroup}</span>
                        </td>
                        <td className="py-3 px-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                          {MODE_LABELS[entry.mode]}
                        </td>
                        <td className="py-3 px-3 text-xs text-slate-700 max-w-xs truncate">
                          {entry.topicOrAction}
                        </td>
                        <td className="py-3 px-3 text-xs font-semibold tabular-nums whitespace-nowrap">
                          <span
                            className={
                              entry.mode === 'plagiarism' && (entry.aiRiskPercent ?? 0) >= 60
                                ? 'text-rose-700'
                                : entry.mode === 'tester'
                                  ? 'text-blue-700'
                                  : 'text-slate-800'
                            }
                          >
                            {entry.scoreOrResult}
                            {entry.aiRiskPercent !== null ? ` (${entry.aiRiskPercent}%)` : ''}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-xs whitespace-nowrap">
                          <span className={entry.syncedToSheets ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                            {entry.syncedToSheets ? 'Записано' : 'Локально'}
                          </span>
                        </td>
                        <td className="py-3 pl-3 pr-5 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteLog(entry.id);
                            }}
                            aria-label="Видалити запис"
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={8} className="px-6 py-4 space-y-3 text-xs text-slate-700">
                            <p className="leading-relaxed">
                              <strong className="font-semibold text-slate-900">Підсумок: </strong>
                              {entry.summary}
                            </p>

                            {entry.details.bestPractice && (
                              <p>
                                <strong className="font-semibold text-slate-900">Рекомендована практика: </strong>
                                {entry.details.bestPractice}
                              </p>
                            )}

                            {entry.details.recommendations && entry.details.recommendations.length > 0 && (
                              <div>
                                <strong className="font-semibold text-slate-900">Рекомендації учню:</strong>
                                <ul className="mt-1 list-disc pl-5 space-y-0.5">
                                  {entry.details.recommendations.map((rec, i) => (
                                    <li key={i}>{rec}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {entry.details.oralCheckQuestions && entry.details.oralCheckQuestions.length > 0 && (
                              <div>
                                <strong className="font-semibold text-slate-900">Запитання для усної перевірки:</strong>
                                <ol className="mt-1 list-decimal pl-5 space-y-0.5">
                                  {entry.details.oralCheckQuestions.map((q, i) => (
                                    <li key={i}>{q}</li>
                                  ))}
                                </ol>
                              </div>
                            )}

                            {entry.details.code && (
                              <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-100">
                                <code>{entry.details.code}</code>
                              </pre>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
