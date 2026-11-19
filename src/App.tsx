import { useEffect, useState } from 'react';
import { FileText, LogOut, Settings2, Table2, User as UserIcon } from 'lucide-react';
import type { User } from 'firebase/auth';
import { ConfirmModal } from './components/ConfirmModal';
import { MentorView } from './components/MentorView';
import { PlagiarismView } from './components/PlagiarismView';
import { TeacherDashboardView } from './components/TeacherDashboardView';
import { TesterView } from './components/TesterView';
import { WorkspaceModal } from './components/WorkspaceModal';
import { MENTOR_STARTER_PRESETS } from './lib/presets';
import { getAccessToken, googleSignIn, initAuth, logout } from './lib/workspaceAuth';
import type {
  AppTab,
  ConfirmDialogState,
  TeacherLogEntry,
  WorkspaceDocInfo,
  WorkspaceSheetInfo,
} from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('mentor');

  // Student identity (for real-time teacher tracking)
  const [studentName, setStudentName] = useState('Олексій Коваленко');
  const [studentGroup, setStudentGroup] = useState('8-А клас');

  // Shared Python editor & task state
  const [mentorCode, setMentorCode] = useState(MENTOR_STARTER_PRESETS[0].code);
  const [mentorTaskContext, setMentorTaskContext] = useState(
    `${MENTOR_STARTER_PRESETS[0].title} (${MENTOR_STARTER_PRESETS[0].topic})`
  );
  const [plagCode, setPlagCode] = useState('');
  const [plagTaskDesc, setPlagTaskDesc] = useState('');

  // Firebase + Google Workspace Auth state (in-memory token only)
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Connected Workspace resources
  const [linkedDoc, setLinkedDoc] = useState<WorkspaceDocInfo | null>(null);
  const [linkedSheet, setLinkedSheet] = useState<WorkspaceSheetInfo | null>(null);
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);

  // Real-time Teacher Telemetry via SSE
  const [logs, setLogs] = useState<TeacherLogEntry[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);

  // Confirmation dialog & toast feedback
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isMutatingWorkspace, setIsMutatingWorkspace] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const unsubscribe = initAuth(
      (authedUser, token) => {
        setUser(authedUser);
        setAccessToken(token);
      },
      (maybeUser) => {
        setUser(maybeUser);
        setAccessToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/teacher/stream');
      es.onopen = () => setStreamConnected(true);
      es.onerror = () => setStreamConnected(false);

      es.addEventListener('init', (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as { logs: TeacherLogEntry[] };
        setLogs(data.logs ?? []);
      });

      es.addEventListener('log_added', (event) => {
        const created = JSON.parse((event as MessageEvent<string>).data) as TeacherLogEntry;
        setLogs((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      });

      es.addEventListener('logs_updated', (event) => {
        const updated = JSON.parse((event as MessageEvent<string>).data) as TeacherLogEntry[];
        setLogs(updated);
      });
    } catch {
      setStreamConnected(false);
    }

    return () => {
      es?.close();
    };
  }, []);

  const showNotice = (type: 'success' | 'error', text: string) => {
    setNotice({ type, text });
    window.setTimeout(() => {
      setNotice((current) => (current?.text === text ? null : current));
    }, 5500);
  };

  const handleGoogleSignIn = async () => {
    setIsLoggingIn(true);
    try {
      const res = await googleSignIn();
      setUser(res.user);
      setAccessToken(res.accessToken);
      showNotice('success', `Підключено Google-акаунт (${res.user.email ?? 'успішно'}).`);
    } catch (err) {
      showNotice(
        'error',
        err instanceof Error ? err.message : 'Не вдалося увійти через Google.'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setUser(null);
    setAccessToken(null);
    setLinkedDoc(null);
    setLinkedSheet(null);
    showNotice('success', 'Ви вийшли з Google-акаунта.');
  };

  const handleRequestAppendDoc = (title: string, content: string) => {
    const token = getAccessToken() ?? accessToken;
    if (!token) {
      setIsWorkspaceModalOpen(true);
      showNotice('error', 'Спочатку увійдіть через Google та підключіть Google Документ.');
      return;
    }
    if (!linkedDoc) {
      setIsWorkspaceModalOpen(true);
      showNotice('error', 'Оберіть або створіть Google Документ для запису результатів.');
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title,
      targetLabel: `Документ: ${linkedDoc.title}`,
      description: `Підтвердьте додавання нового розділу з текстом звіту в кінець документа «${linkedDoc.title}». Існуючий вміст документа збережеться без змін.`,
      confirmLabel: 'Записати в документ',
      onConfirm: async () => {
        setIsMutatingWorkspace(true);
        try {
          const res = await fetch(`/api/workspace/docs/${encodeURIComponent(linkedDoc.id)}/append`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: content }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok) throw new Error(data.error || 'Помилка запису в Google Docs');
          setConfirmDialog(null);
          showNotice('success', `Матеріал успішно додано в Google Документ «${linkedDoc.title}».`);
        } catch (err) {
          showNotice('error', err instanceof Error ? err.message : 'Не вдалося оновити Google Документ.');
        } finally {
          setIsMutatingWorkspace(false);
        }
      },
    });
  };

  const handleRequestSyncToSheet = (entriesToSync: TeacherLogEntry[]) => {
    const token = getAccessToken() ?? accessToken;
    if (!token || !linkedSheet) {
      setIsWorkspaceModalOpen(true);
      return;
    }

    setConfirmDialog({
      isOpen: true,
      title: 'Синхронізація з Google Таблицею вчителя',
      targetLabel: `${linkedSheet.title} · аркуш «${linkedSheet.activeTab}»`,
      description: `У таблицю буде додано ${entriesToSync.length} нових рядків із результатами та діями учнів. Підтвердіть запис у Google Таблицю.`,
      confirmLabel: `Додати рядки (${entriesToSync.length})`,
      onConfirm: async () => {
        setIsMutatingWorkspace(true);
        try {
          const res = await fetch(`/api/workspace/sheets/${encodeURIComponent(linkedSheet.id)}/append`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              tabName: linkedSheet.activeTab,
              entries: entriesToSync,
            }),
          });
          const data = (await res.json()) as { ok?: boolean; updatedRows?: number; error?: string };
          if (!res.ok) throw new Error(data.error || 'Помилка запису в Google Sheets');
          setConfirmDialog(null);
          showNotice(
            'success',
            `У Google Таблицю «${linkedSheet.title}» додано ${data.updatedRows ?? entriesToSync.length} рядків.`
          );
        } catch (err) {
          showNotice('error', err instanceof Error ? err.message : 'Не вдалося оновити Google Таблицю.');
        } finally {
          setIsMutatingWorkspace(false);
        }
      },
    });
  };

  const handleDeleteLog = async (id: string) => {
    await fetch(`/api/teacher/logs/${encodeURIComponent(id)}`, { method: 'DELETE' });
  };

  const handleImportDocToApp = (plainText: string) => {
    const codeIndex = plainText.indexOf('def ');
    if (codeIndex !== -1) {
      const taskPart = plainText.slice(0, codeIndex).trim();
      const codePart = plainText.slice(codeIndex).trim();
      if (taskPart) setMentorTaskContext(taskPart.slice(0, 260));
      if (codePart) setMentorCode(codePart);
    } else {
      setMentorTaskContext(plainText.slice(0, 320));
    }
    setActiveTab('mentor');
    showNotice('success', 'Матеріал із Google Документа завантажено в робочу область.');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
          {/* Zone 1: Single text element wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab('mentor')}
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
          >
            PyMentor
          </button>

          {/* Zone 2: 4 single-line navigation links */}
          <nav className="flex items-center gap-6 overflow-x-auto text-sm font-medium">
            {(
              [
                { id: 'mentor', label: 'Ментор' },
                { id: 'tester', label: 'Тестувальник' },
                { id: 'plagiarism', label: 'Антиплагіат' },
                { id: 'teacher', label: 'Таблиця вчителя' },
              ] as const
            ).map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`relative py-1 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'text-blue-700 font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{item.label}</span>
                  {isActive && (
                    <span
                      className="absolute inset-x-0 -bottom-[15px] h-0.5 bg-blue-700"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center shrink-0">
            {accessToken ? (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                title={user?.email ?? 'Вийти з Google'}
              >
                <LogOut className="h-3.5 w-3.5 text-slate-500" />
                <span>Вийти ({user?.displayName?.split(' ')[0] ?? 'Google'})</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleGoogleSignIn()}
                disabled={isLoggingIn}
                className="gsi-material-button shrink-0"
              >
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Вхід...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-6 py-6 space-y-5">
        {/* Workspace Toolbar (Student Profile + Google Docs / Sheets Automation Controls) */}
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <UserIcon className="h-4 w-4 text-slate-400" />
              <label htmlFor="student-name-input" className="whitespace-nowrap">
                Учень:
              </label>
              <input
                id="student-name-input"
                type="text"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                className="w-40 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
              <label htmlFor="student-group-input" className="whitespace-nowrap">
                Група:
              </label>
              <input
                id="student-group-input"
                type="text"
                value={studentGroup}
                onChange={(e) => setStudentGroup(e.target.value)}
                className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-blue-600 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="hidden md:flex items-center gap-3 text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-blue-700" />
                <span>{linkedDoc ? linkedDoc.title : 'Документ не підключено'}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5">
                <Table2 className="h-3.5 w-3.5 text-emerald-700" />
                <span>{linkedSheet ? linkedSheet.title : 'Таблиця не підключена'}</span>
              </span>
            </div>

            <button
              type="button"
              onClick={() => setIsWorkspaceModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition-colors whitespace-nowrap"
            >
              <Settings2 className="h-3.5 w-3.5 text-blue-700" />
              <span>Google Docs / Sheets</span>
            </button>
          </div>
        </section>

        {/* Notice Banner */}
        {notice && (
          <div
            role="status"
            className={`rounded-xl border px-4 py-3 text-sm ${
              notice.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            {notice.text}
          </div>
        )}

        {/* Active View */}
        {activeTab === 'mentor' && (
          <MentorView
            studentName={studentName}
            studentGroup={studentGroup}
            code={mentorCode}
            onCodeChange={setMentorCode}
            taskContext={mentorTaskContext}
            onTaskContextChange={setMentorTaskContext}
            linkedDoc={linkedDoc}
            onSendToPlagiarism={(codeToCheck, taskDesc) => {
              setPlagCode(codeToCheck);
              setPlagTaskDesc(taskDesc);
              setActiveTab('plagiarism');
            }}
            onRequestAppendDoc={handleRequestAppendDoc}
            onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
          />
        )}

        {activeTab === 'tester' && (
          <TesterView
            studentName={studentName}
            studentGroup={studentGroup}
            linkedDoc={linkedDoc}
            onRequestAppendDoc={handleRequestAppendDoc}
            onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
          />
        )}

        {activeTab === 'plagiarism' && (
          <PlagiarismView
            studentName={studentName}
            studentGroup={studentGroup}
            code={plagCode}
            onCodeChange={setPlagCode}
            taskDescription={plagTaskDesc}
            onTaskDescriptionChange={setPlagTaskDesc}
            onRequestAppendDoc={handleRequestAppendDoc}
          />
        )}

        {activeTab === 'teacher' && (
          <TeacherDashboardView
            logs={logs}
            streamConnected={streamConnected}
            linkedSheet={linkedSheet}
            onOpenWorkspaceModal={() => setIsWorkspaceModalOpen(true)}
            onRequestSyncToSheet={handleRequestSyncToSheet}
            onDeleteLog={handleDeleteLog}
          />
        )}
      </main>

      <WorkspaceModal
        isOpen={isWorkspaceModalOpen}
        onClose={() => setIsWorkspaceModalOpen(false)}
        accessToken={accessToken}
        userEmail={user?.email ?? null}
        onSignIn={handleGoogleSignIn}
        linkedDoc={linkedDoc}
        linkedSheet={linkedSheet}
        onLinkDoc={(doc) => setLinkedDoc(doc)}
        onLinkSheet={(sheet) => setLinkedSheet(sheet)}
        onImportDocToApp={handleImportDocToApp}
      />

      <ConfirmModal
        dialog={confirmDialog}
        isLoading={isMutatingWorkspace}
        onClose={() => setConfirmDialog(null)}
      />
    </div>
  );
}
