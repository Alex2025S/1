import { useEffect, useState } from 'react';
import { ExternalLink, FileText, FolderOpen, Plus, RefreshCw, Table2, X } from 'lucide-react';
import type { DriveFileItem, WorkspaceDocInfo, WorkspaceSheetInfo } from '../types';
import { parseGoogleResourceId } from '../lib/workspaceAuth';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  accessToken: string | null;
  userEmail: string | null;
  onSignIn: () => Promise<void>;
  linkedDoc: WorkspaceDocInfo | null;
  linkedSheet: WorkspaceSheetInfo | null;
  onLinkDoc: (doc: WorkspaceDocInfo) => void;
  onLinkSheet: (sheet: WorkspaceSheetInfo) => void;
  onImportDocToApp: (plainText: string) => void;
}

export function WorkspaceModal({
  isOpen,
  onClose,
  accessToken,
  userEmail,
  onSignIn,
  linkedDoc,
  linkedSheet,
  onLinkDoc,
  onLinkSheet,
  onImportDocToApp,
}: WorkspaceModalProps) {
  const [docInput, setDocInput] = useState('');
  const [sheetInput, setSheetInput] = useState('');
  const [files, setFiles] = useState<DriveFileItem[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadFiles = async () => {
    if (!accessToken) return;
    setBusyAction('files');
    setErrorMsg(null);
    try {
      const res = await fetch('/api/workspace/files', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { files?: DriveFileItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Помилка завантаження файлів');
      setFiles(data.files ?? []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка Google Drive');
    } finally {
      setBusyAction(null);
    }
  };

  useEffect(() => {
    if (isOpen && accessToken) {
      void loadFiles();
    }
  }, [isOpen, accessToken]);

  if (!isOpen) return null;

  const handleCreateDoc = async () => {
    if (!accessToken) return;
    setBusyAction('create_doc');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/workspace/docs/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'PyMentor — Навчальний зошит Python' }),
      });
      const data = (await res.json()) as WorkspaceDocInfo & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Не вдалося створити документ');
      onLinkDoc(data);
      setSuccessMsg(`Створено та підключено Google Документ «${data.title}».`);
      await loadFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка створення документа');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectDocById = async (rawId?: string) => {
    if (!accessToken) return;
    const docId = parseGoogleResourceId(rawId ?? docInput);
    if (!docId) {
      setErrorMsg('Вставте посилання або ID Google Документа.');
      return;
    }
    setBusyAction('read_doc');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/workspace/docs/${encodeURIComponent(docId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as WorkspaceDocInfo & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Не вдалося відкрити документ');
      onLinkDoc(data);
      setDocInput('');
      setSuccessMsg(`Підключено Google Документ «${data.title}».`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка підключення документа');
    } finally {
      setBusyAction(null);
    }
  };

  const handleCreateSheet = async () => {
    if (!accessToken) return;
    setBusyAction('create_sheet');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch('/api/workspace/sheets/create', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'PyMentor — Прогрес учнів (Таблиця вчителя)' }),
      });
      const data = (await res.json()) as WorkspaceSheetInfo & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Не вдалося створити таблицю');
      onLinkSheet(data);
      setSuccessMsg(`Створено та підключено Google Таблицю «${data.title}».`);
      await loadFiles();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка створення таблиці');
    } finally {
      setBusyAction(null);
    }
  };

  const handleConnectSheetById = async (rawId?: string) => {
    if (!accessToken) return;
    const sheetId = parseGoogleResourceId(rawId ?? sheetInput);
    if (!sheetId) {
      setErrorMsg('Вставте посилання або ID Google Таблиці.');
      return;
    }
    setBusyAction('read_sheet');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/workspace/sheets/${encodeURIComponent(sheetId)}/meta`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as WorkspaceSheetInfo & { error?: string };
      if (!res.ok) throw new Error(data.error || 'Не вдалося відкрити таблицю');
      onLinkSheet(data);
      setSheetInput('');
      setSuccessMsg(`Підключено Google Таблицю «${data.title}» (аркуш: ${data.activeTab}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Помилка підключення таблиці');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="workspace-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 id="workspace-modal-title" className="text-lg font-semibold text-slate-900">
              Інтеграція з Google Docs і Google Sheets
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {userEmail
                ? `Підключено акаунт: ${userEmail}`
                : 'Увійдіть через Google, щоб автоматизувати навчальні документи та таблицю вчителя'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Закрити вікно"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!accessToken ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center space-y-4">
              <p className="text-sm text-slate-700 max-w-lg mx-auto leading-relaxed">
                Для створення навчальних документів, імпорту завдань з Google Docs та автоматичного запису прогресу
                учнів у Google Таблицю вчителя увійдіть у свій обліковий запис Google.
              </p>
              <div className="flex justify-center">
                <button type="button" onClick={() => void onSignIn()} className="gsi-material-button">
                  <div className="gsi-material-button-content-wrapper">
                    <div className="gsi-material-button-icon">
                      <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                      </svg>
                    </div>
                    <span className="gsi-material-button-contents">Sign in with Google</span>
                  </div>
                </button>
              </div>
            </div>
          ) : (
            <>
              {errorMsg && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {errorMsg}
                </div>
              )}
              {successMsg && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  {successMsg}
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {/* Google Docs Section */}
                <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <FileText className="h-4 w-4 text-blue-700" />
                      <span>Навчальний Google Документ</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCreateDoc()}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{busyAction === 'create_doc' ? 'Створення...' : 'Створити новий'}</span>
                    </button>
                  </div>

                  {linkedDoc ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-slate-900">{linkedDoc.title}</p>
                        <a
                          href={linkedDoc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0"
                        >
                          <span>Відкрити</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      {linkedDoc.plainText && (
                        <button
                          type="button"
                          onClick={() => {
                            onImportDocToApp(linkedDoc.plainText || '');
                            onClose();
                          }}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          Завантажити текст із документа в редактор
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Документ ще не підключено. Створіть шаблонний зошит або вставте URL наявного Google Docs.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={docInput}
                      onChange={(e) => setDocInput(e.target.value)}
                      placeholder="URL або ID Google Docs..."
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleConnectDocById()}
                      disabled={busyAction !== null}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      Підключити
                    </button>
                  </div>
                </section>

                {/* Google Sheets Section */}
                <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Table2 className="h-4 w-4 text-emerald-700" />
                      <span>Google Таблиця вчителя</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCreateSheet()}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{busyAction === 'create_sheet' ? 'Створення...' : 'Створити таблицю'}</span>
                    </button>
                  </div>

                  {linkedSheet ? (
                    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{linkedSheet.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Активний аркуш: {linkedSheet.activeTab}
                          </p>
                        </div>
                        <a
                          href={linkedSheet.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap shrink-0"
                        >
                          <span>Відкрити</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      {linkedSheet.tabs.length > 1 && (
                        <div className="flex items-center gap-2">
                          <label htmlFor="sheet-tab-select" className="text-xs text-slate-600 whitespace-nowrap">
                            Аркуш:
                          </label>
                          <select
                            id="sheet-tab-select"
                            value={linkedSheet.activeTab}
                            onChange={(e) =>
                              onLinkSheet({
                                ...linkedSheet,
                                activeTab: e.target.value,
                              })
                            }
                            className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800"
                          >
                            {linkedSheet.tabs.map((tab) => (
                              <option key={tab.sheetId} value={tab.title}>
                                {tab.title}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Створіть нову таблицю прогресу для класу або підключіть вашу Google Таблицю за посиланням.
                    </p>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={sheetInput}
                      onChange={(e) => setSheetInput(e.target.value)}
                      placeholder="URL або ID Google Sheets..."
                      className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void handleConnectSheetById()}
                      disabled={busyAction !== null}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      Підключити
                    </button>
                  </div>
                </section>
              </div>

              {/* Recent Drive Files */}
              <section className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <FolderOpen className="h-4 w-4 text-slate-500" />
                    <span>Файли, створені або відкриті через PyMentor</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadFiles()}
                    disabled={busyAction === 'files'}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${busyAction === 'files' ? 'animate-spin' : ''}`} />
                    <span>Оновити</span>
                  </button>
                </div>

                {files.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-500">
                    Поки немає файлів у списку. Натисніть «Створити новий» або підключіть документ за посиланням.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                    {files.map((file) => {
                      const isDoc = file.mimeType === 'application/vnd.google-apps.document';
                      return (
                        <div key={file.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex items-center gap-2.5">
                            {isDoc ? (
                              <FileText className="h-4 w-4 shrink-0 text-blue-700" />
                            ) : (
                              <Table2 className="h-4 w-4 shrink-0 text-emerald-700" />
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                              <p className="text-xs text-slate-500">
                                {isDoc ? 'Google Документ' : 'Google Таблиця'}
                                {file.modifiedTime
                                  ? ` · Оновлено ${new Date(file.modifiedTime).toLocaleDateString('uk-UA')}`
                                  : ''}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              isDoc
                                ? void handleConnectDocById(file.id)
                                : void handleConnectSheetById(file.id)
                            }
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                          >
                            Обрати
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
