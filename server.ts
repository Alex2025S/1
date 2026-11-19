import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  DifficultyLevel,
  PlagiarismAnalysisResult,
  TeacherLogEntry,
  TestEvaluationResult,
  TestTask,
} from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const PRIMARY_MODEL_ID = 'gemini-3.1-flash-lite';
const FALLBACK_MODEL_ID = 'gemini-4-hydrogen';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TELEMETRY_FILE = path.join(DATA_DIR, 'telemetry.json');

function ensureTelemetryStore(): TeacherLogEntry[] {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(TELEMETRY_FILE)) {
      fs.writeFileSync(TELEMETRY_FILE, '[]', 'utf-8');
      return [];
    }
    const raw = fs.readFileSync(TELEMETRY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TeacherLogEntry[]) : [];
  } catch (err) {
    console.error('Failed to initialize telemetry store:', err);
    return [];
  }
}

let telemetryLogs: TeacherLogEntry[] = ensureTelemetryStore();
const sseClients = new Set<Response>();

function saveTelemetryLogs() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(TELEMETRY_FILE, JSON.stringify(telemetryLogs, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist telemetry logs:', err);
  }
}

function broadcastSse(event: string, payload: unknown) {
  const chunk = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(chunk);
    } catch {
      sseClients.delete(client);
    }
  }
}

function recordTeacherLog(entry: Omit<TeacherLogEntry, 'id' | 'timestamp' | 'syncedToSheets'>): TeacherLogEntry {
  const created: TeacherLogEntry = {
    ...entry,
    id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    syncedToSheets: false,
  };
  telemetryLogs = [created, ...telemetryLogs].slice(0, 500);
  saveTelemetryLogs();
  broadcastSse('log_added', created);
  return created;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('aborted') ||
    msg.includes('timeout')
  );
}

async function generateContentSmart(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction?: string;
    responseMimeType?: string;
    responseSchema?: unknown;
  }
) {
  const buildConfig = (model: string, abortSignal?: AbortSignal) => ({
    ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
    ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
    ...(params.responseSchema ? { responseSchema: params.responseSchema } : {}),
    ...(abortSignal ? { abortSignal } : {}),
    thinkingConfig: {
      thinkingLevel: model === PRIMARY_MODEL_ID ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
    },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 8000);
  try {
    return await ai.models.generateContent({
      model: PRIMARY_MODEL_ID,
      contents: params.contents,
      config: buildConfig(PRIMARY_MODEL_ID, controller.signal) as never,
    });
  } catch (err) {
    if (!isTransientModelError(err)) {
      throw err;
    }
    const fbController = new AbortController();
    const fbTimer = setTimeout(() => fbController.abort(new Error('timeout')), 9000);
    try {
      return await ai.models.generateContent({
        model: FALLBACK_MODEL_ID,
        contents: params.contents,
        config: buildConfig(FALLBACK_MODEL_ID, fbController.signal) as never,
      });
    } finally {
      clearTimeout(fbTimer);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function* generateContentStreamSmart(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction?: string;
  }
): AsyncGenerator<string> {
  const buildConfig = (model: string, abortSignal?: AbortSignal) => ({
    ...(params.systemInstruction ? { systemInstruction: params.systemInstruction } : {}),
    ...(abortSignal ? { abortSignal } : {}),
    thinkingConfig: {
      thinkingLevel: model === PRIMARY_MODEL_ID ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW,
    },
  });

  let emittedAny = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), 7000);
  try {
    const stream = await ai.models.generateContentStream({
      model: PRIMARY_MODEL_ID,
      contents: params.contents,
      config: buildConfig(PRIMARY_MODEL_ID, controller.signal) as never,
    });
    for await (const chunk of stream) {
      const text = chunk.text ?? '';
      if (text) {
        emittedAny = true;
        yield text;
      }
    }
    return;
  } catch (err) {
    if (emittedAny || !isTransientModelError(err)) {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  const fbController = new AbortController();
  const fbTimer = setTimeout(() => fbController.abort(new Error('timeout')), 9000);
  try {
    const fallbackStream = await ai.models.generateContentStream({
      model: FALLBACK_MODEL_ID,
      contents: params.contents,
      config: buildConfig(FALLBACK_MODEL_ID, fbController.signal) as never,
    });
    for await (const chunk of fallbackStream) {
      const text = chunk.text ?? '';
      if (text) {
        yield text;
      }
    }
  } finally {
    clearTimeout(fbTimer);
  }
}

function formatGeminiError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('GEMINI_API_KEY is not configured')) {
    return {
      status: 500,
      message: 'Серверний ключ GEMINI_API_KEY не налаштовано. Перевірте панель Settings > Secrets.',
    };
  }
  if (msg.includes('PERMISSION_DENIED') || msg.includes('API_KEY_INVALID') || msg.includes('403') || msg.includes('400')) {
    return {
      status: 400,
      message: 'Помилка доступу до Gemini API. Перевірте налаштування ключа в Settings > Secrets.',
    };
  }
  if (msg.includes('503') || msg.includes('UNAVAILABLE')) {
    return {
      status: 503,
      message: 'Сервіс ШІ тимчасово перевантажений. Спробуйте повторити запит через кілька секунд.',
    };
  }
  if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
    return {
      status: 429,
      message: 'Перевищено ліміт запитів до Gemini API. Спробуйте через кілька секунд.',
    };
  }
  return {
    status: 500,
    message: `Помилка обробки запиту ШІ: ${msg}`,
  };
}

function difficultyLabelUk(level: DifficultyLevel): string {
  switch (level) {
    case 'beginner':
      return 'Початковий';
    case 'intermediate':
      return 'Середній';
    case 'advanced':
      return 'Просунутий';
    default:
      return 'Середній';
  }
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function extractTextFromGoogleDoc(docJson: Record<string, unknown>): string {
  const body = docJson.body as { content?: Array<Record<string, unknown>> } | undefined;
  if (!body || !Array.isArray(body.content)) {
    return '';
  }

  const lines: string[] = [];

  const readElements = (elements: Array<Record<string, unknown>>) => {
    for (const element of elements) {
      const textRun = element.textRun as { content?: string } | undefined;
      if (textRun && typeof textRun.content === 'string') {
        lines.push(textRun.content);
      }
    }
  };

  for (const structural of body.content) {
    const paragraph = structural.paragraph as { elements?: Array<Record<string, unknown>> } | undefined;
    if (paragraph && Array.isArray(paragraph.elements)) {
      readElements(paragraph.elements);
    }
    const table = structural.table as {
      tableRows?: Array<{
        tableCells?: Array<{
          content?: Array<Record<string, unknown>>;
        }>;
      }>;
    } | undefined;
    if (table && Array.isArray(table.tableRows)) {
      for (const row of table.tableRows) {
        if (!Array.isArray(row.tableCells)) continue;
        const cellTexts: string[] = [];
        for (const cell of row.tableCells) {
          if (!Array.isArray(cell.content)) continue;
          const cellParts: string[] = [];
          for (const item of cell.content) {
            const p = item.paragraph as { elements?: Array<Record<string, unknown>> } | undefined;
            if (p && Array.isArray(p.elements)) {
              for (const el of p.elements) {
                const tr = el.textRun as { content?: string } | undefined;
                if (tr?.content) cellParts.push(tr.content.trim());
              }
            }
          }
          cellTexts.push(cellParts.join(' '));
        }
        if (cellTexts.some(Boolean)) {
          lines.push(cellTexts.join(' | ') + '\n');
        }
      }
    }
  }

  return lines.join('').trim();
}

function getDocumentEndIndex(docJson: Record<string, unknown>): number {
  const body = docJson.body as { content?: Array<{ endIndex?: number }> } | undefined;
  if (!body || !Array.isArray(body.content) || body.content.length === 0) {
    return 1;
  }
  const last = body.content[body.content.length - 1];
  const endIdx = typeof last.endIndex === 'number' ? last.endIndex : 2;
  return Math.max(1, endIdx - 1);
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // =========================================================
  // 1. PYTHON DEBUGGING MENTOR (NO DIRECT SOLUTIONS RULE)
  // =========================================================
  app.post('/api/mentor/chat', async (req: Request, res: Response) => {
    try {
      const {
        studentName = 'Учень',
        studentGroup = 'Група 1',
        code = '',
        errorLog = '',
        history = [],
        message = '',
        taskContext = '',
      } = req.body as {
        studentName?: string;
        studentGroup?: string;
        code?: string;
        errorLog?: string;
        history?: Array<{ role: 'student' | 'mentor'; content: string }>;
        message?: string;
        taskContext?: string;
      };

      if (!code.trim() && !message.trim()) {
        res.status(400).json({ error: 'Додайте код Python або опишіть запитання для ментора.' });
        return;
      }

      const ai = getGeminiClient();

      const systemInstruction = [
        'Ти — досвідчений, доброзичливий та вимогливий ментор з програмування на Python для школярів та початківців.',
        'Твоє головне правило (АБСОЛЮТНА ЗАБОРОНА): НІКОЛИ не давай учневі готовий виправлений код, готове рішення задачі або повний переписаний фрагмент коду, який вирішує помилку учня.',
        'Навіть якщо учень прямо просить "просто напиши правильний код", "покажи готове рішення" або "виправ за мене" — ввічливо відмов і поясни, що справжнє розуміння приходить через самостійне виправлення за підказками.',
        'Твоє завдання при кожному зверненні:',
        '1. Проаналізувати код учня, повідомлення про помилку (traceback) та контекст завдання.',
        '2. Чітко пояснити ЛОГІКУ ПОМИЛКИ: чому Python поводиться саме так (типи даних, індексація, область видимості, умови зупинки, мутабельність тощо).',
        '3. Вказати на конкретний рядок або конструкцію і дати спрямовуючу ПІДКАЗКУ або навідне запитання, яке підведе учня до правильного рішення.',
        '4. Додати коротку пораду щодо НАЙКРАЩИХ ПРАКТИК кодування Python (PEP 8, читабельність, крайові випадки, f-рядки, змістовні назви змінних).',
        '5. Можеш наводити лише мінімальні абстрактні приклади синтаксису з ІНШОЇ теми (наприклад, 1 рядок як працює range()), але ніколи не розв’язуй конкретну задачу учня.',
        'Відповідай українською мовою. У полі replyMarkdown використовуй чисте форматування (короткі абзаци, марковані списки, номери рядків).',
      ].join('\n');

      const formattedHistory = (Array.isArray(history) ? history : [])
        .slice(-8)
        .map((h) => `${h.role === 'student' ? 'Учень' : 'Ментор'}: ${h.content}`)
        .join('\n\n');

      const numberedCode = code
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');

      const promptParts = [
        taskContext ? `Контекст навчального завдання (з Google Docs / теми):\n${taskContext}\n` : '',
        `Код учня (з номерами рядків):\n\`\`\`python\n${numberedCode || '# код не надано'}\n\`\`\``,
        errorLog ? `Вивід помилки / очікуваний результат:\n${errorLog}` : '',
        formattedHistory ? `Попередній діалог:\n${formattedHistory}` : '',
        `Поточне повідомлення учня (${studentName}):\n${message || 'Проаналізуй мій код і допоможи знайти помилку підказками.'}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await generateContentSmart(ai, {
        contents: promptParts,
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyMarkdown: {
              type: Type.STRING,
              description: 'Стисла менторська відповідь українською мовою (до 180 слів) з поясненням логіки помилки, підказкою без готового рішення та порадою щодо найкращих практик.',
            },
            errorType: {
              type: Type.STRING,
              description: 'Коротка назва типу помилки (наприклад: IndexError / Межі списку, Логічна помилка циклу, TypeError, Без помилок).',
            },
            detectedConcept: {
              type: Type.STRING,
              description: 'Ключова тема Python, яку відпрацьовує учень (наприклад: Списки та range, Умова виходу рекурсії, Словники).',
            },
            bestPracticeTip: {
              type: Type.STRING,
              description: '1 коротке речення поради щодо кращих практик кодування (PEP 8 / стиль).',
            },
            hintSummary: {
              type: Type.STRING,
              description: 'Короткий підсумок підказки для таблиці вчителя (до 140 символів).',
            },
          },
          required: ['replyMarkdown', 'errorType', 'detectedConcept', 'bestPracticeTip', 'hintSummary'],
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText) as {
        replyMarkdown: string;
        errorType: string;
        detectedConcept: string;
        bestPracticeTip: string;
        hintSummary: string;
      };

      const logEntry = recordTeacherLog({
        studentName: studentName.trim() || 'Учень',
        studentGroup: studentGroup.trim() || 'Група 1',
        mode: 'mentor',
        topicOrAction: `${parsed.detectedConcept} (${parsed.errorType})`,
        difficultyLabel: 'Ментор-сесія',
        scoreOrResult: 'Надано підказку',
        aiRiskPercent: null,
        summary: parsed.hintSummary,
        details: {
          code,
          errorLog,
          mentorHint: parsed.replyMarkdown,
          bestPractice: parsed.bestPracticeTip,
        },
      });

      res.json({
        reply: parsed.replyMarkdown,
        meta: {
          errorType: parsed.errorType,
          detectedConcept: parsed.detectedConcept,
          bestPracticeTip: parsed.bestPracticeTip,
        },
        logEntry,
      });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/mentor/chat/stream', async (req: Request, res: Response) => {
    try {
      const {
        studentName = 'Учень',
        studentGroup = 'Група 1',
        code = '',
        errorLog = '',
        history = [],
        message = '',
        taskContext = '',
      } = req.body as {
        studentName?: string;
        studentGroup?: string;
        code?: string;
        errorLog?: string;
        history?: Array<{ role: 'student' | 'mentor'; content: string }>;
        message?: string;
        taskContext?: string;
      };

      if (!code.trim() && !message.trim()) {
        res.status(400).json({ error: 'Додайте код Python або опишіть запитання для ментора.' });
        return;
      }

      const ai = getGeminiClient();

      const systemInstruction = [
        'Ти — досвідчений, доброзичливий ментор з програмування на Python для школярів.',
        'ГОЛОВНЕ ПРАВИЛО: НІКОЛИ не давай учневі готовий виправлений код або повне рішення. Навіть якщо учень прямо просить готовий код — ввічливо відмов і дай лише спрямовуючу підказку.',
        'Відповідай стисло, чітко і по суті (до 150 слів) українською мовою у форматі:',
        '**Логіка помилки:** 1–2 речення, чому Python так поводиться.',
        '**Підказка:** на який рядок звернути увагу та навідне запитання.',
        '**Краща практика (PEP 8):** 1 конкретна порада щодо стилю чи надійності коду.',
      ].join('\n');

      const formattedHistory = (Array.isArray(history) ? history : [])
        .slice(-6)
        .map((h) => `${h.role === 'student' ? 'Учень' : 'Ментор'}: ${h.content}`)
        .join('\n\n');

      const numberedCode = code
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');

      const promptParts = [
        taskContext ? `Контекст завдання:\n${taskContext}` : '',
        `Код учня (з номерами рядків):\n\`\`\`python\n${numberedCode || '# код не надано'}\n\`\`\``,
        errorLog ? `Помилка / очікуваний результат:\n${errorLog}` : '',
        formattedHistory ? `Попередній діалог:\n${formattedHistory}` : '',
        `Запит учня (${studentName}): ${message || 'Проаналізуй код і дай підказку.'}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      const stream = generateContentStreamSmart(ai, {
        contents: promptParts,
        systemInstruction,
      });

      let fullReply = '';
      for await (const textChunk of stream) {
        if (textChunk) {
          fullReply += textChunk;
          res.write(`event: chunk\ndata: ${JSON.stringify({ text: textChunk })}\n\n`);
        }
      }

      const detectedErrorMatch = errorLog.match(/\b([A-Za-z]+Error)\b/);
      const errorType = detectedErrorMatch ? detectedErrorMatch[1] : 'Логічний розбір';
      const detectedConcept = taskContext ? taskContext.slice(0, 60) : 'Дебагінг Python';
      const firstSentence = fullReply.replace(/[#*`]/g, '').split(/[.!?]\s/)[0]?.slice(0, 140) || 'Надано спрямовуючу підказку';

      const logEntry = recordTeacherLog({
        studentName: studentName.trim() || 'Учень',
        studentGroup: studentGroup.trim() || 'Група 1',
        mode: 'mentor',
        topicOrAction: `${detectedConcept} (${errorType})`,
        difficultyLabel: 'Ментор-сесія',
        scoreOrResult: 'Надано підказку',
        aiRiskPercent: null,
        summary: firstSentence,
        details: {
          code,
          errorLog,
          mentorHint: fullReply,
        },
      });

      res.write(
        `event: done\ndata: ${JSON.stringify({
          meta: { errorType, detectedConcept },
          logEntry,
        })}\n\n`
      );
      res.end();
    } catch (err) {
      const formatted = formatGeminiError(err);
      if (!res.headersSent) {
        res.status(formatted.status).json({ error: formatted.message });
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ error: formatted.message })}\n\n`);
        res.end();
      }
    }
  });

  // =========================================================
  // 2. KNOWLEDGE TESTER (3 DIFFICULTY LEVELS + GRADING)
  // =========================================================
  app.post('/api/tester/generate', async (req: Request, res: Response) => {
    try {
      const {
        difficulty = 'beginner',
        topic = 'Основи Python: цикли, умови та функції',
        docContext = '',
        questionCount = 4,
      } = req.body as {
        difficulty?: DifficultyLevel;
        topic?: string;
        docContext?: string;
        questionCount?: number;
      };

      const count = Math.min(Math.max(Number(questionCount) || 4, 3), 5);
      const ai = getGeminiClient();

      const levelGuidance: Record<DifficultyLevel, string> = {
        beginner:
          'Початковий рівень (для учнів 5–7 класів або початківців): змінні, input/print, типи int/str, умови if/elif/else, прості цикли for з range() або while. Простий, зрозумілий код 4–8 рядків.',
        intermediate:
          'Середній рівень (практика): функції def та return, списки, зрізи, словники, робота з рядками, вкладені цикли, пошук тонких логічних помилок або мутабельності. Код 6–14 рядків.',
        advanced:
          'Просунутий рівень (поглиблений): рекурсія, генератори списків, алгоритмічна складність, обробка винятків, замикання/область видимості, складний дебагінг. Код 8–18 рядків.',
      };

      const prompt = [
        `Згенеруй рівно ${count} різноманітних навчальних завдань з Python для перевірки знань і навичок дебагінгу.`,
        `Рівень складності: ${difficultyLabelUk(difficulty)} — ${levelGuidance[difficulty]}`,
        `Тема: ${topic}`,
        docContext ? `Матеріал уроку з Google Docs (врахуй при формуванні завдань):\n${docContext.slice(0, 3500)}` : '',
        'Типи завдань мають чергуватися:',
        '- "find_bug": знайди та поясни помилку в наведеному фрагменті коду Python',
        '- "predict_output": передбач точний результат виконання коду (або яка помилка виникне)',
        '- "fix_logic": напиши, що саме і чому треба змінити, щоб код працював за умовою',
        'Усі формулювання українською мовою. Код у codeSnippet повинен бути синтаксично коректним для читання (або містити цілеспрямовану навчальну помилку для find_bug).',
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await generateContentSmart(ai, {
        contents: prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING, description: 'find_bug | predict_output | fix_logic' },
                  title: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  codeSnippet: { type: Type.STRING },
                  hint: { type: Type.STRING },
                  expectedConcept: { type: Type.STRING },
                },
                required: ['id', 'type', 'title', 'prompt', 'codeSnippet', 'hint', 'expectedConcept'],
              },
            },
          },
          required: ['tasks'],
        },
      });

      const rawText = (response.text ?? '{"tasks":[]}').trim();
      const parsed = JSON.parse(rawText) as { tasks: TestTask[] };

      res.json({ tasks: parsed.tasks });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.post('/api/tester/evaluate', async (req: Request, res: Response) => {
    try {
      const {
        studentName = 'Учень',
        studentGroup = 'Група 1',
        difficulty = 'beginner',
        topic = 'Основи Python',
        tasks = [],
        answers = {},
      } = req.body as {
        studentName?: string;
        studentGroup?: string;
        difficulty?: DifficultyLevel;
        topic?: string;
        tasks?: TestTask[];
        answers?: Record<string, string>;
      };

      if (!Array.isArray(tasks) || tasks.length === 0) {
        res.status(400).json({ error: 'Немає завдань для перевірки.' });
        return;
      }

      const ai = getGeminiClient();

      const bundle = tasks.map((t, index) => ({
        index: index + 1,
        taskId: t.id,
        type: t.type,
        title: t.title,
        prompt: t.prompt,
        codeSnippet: t.codeSnippet,
        expectedConcept: t.expectedConcept,
        studentAnswer: answers[t.id] ?? '(відповідь не надано)',
      }));

      const prompt = [
        `Оціни відповіді учня (${studentName}) на тест з Python (рівень: ${difficultyLabelUk(difficulty)}, тема: ${topic}).`,
        'Будь об’єктивним, але підтримуючим педагогом. Оцінюй за 12-бальною шкалою (score12 від 1 до 12) та у відсотках (percentage від 0 до 100).',
        'Для кожного завдання постав score (0..3) з maxScore=3, поясни що правильно або де помилка (explanation), і дай пораду щодо кращої практики Python (bestPractice).',
        'Наприкінці сформуй 3 конкретні персональні рекомендації (recommendations) для закріплення матеріалу.',
        `Завдання та відповіді учня:\n${JSON.stringify(bundle, null, 2)}`,
      ].join('\n\n');

      const response = await generateContentSmart(ai, {
        contents: prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score12: { type: Type.INTEGER },
            percentage: { type: Type.INTEGER },
            overallVerdict: { type: Type.STRING },
            recommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            perTaskFeedback: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  taskId: { type: Type.STRING },
                  isCorrect: { type: Type.BOOLEAN },
                  score: { type: Type.INTEGER },
                  maxScore: { type: Type.INTEGER },
                  explanation: { type: Type.STRING },
                  bestPractice: { type: Type.STRING },
                },
                required: ['taskId', 'isCorrect', 'score', 'maxScore', 'explanation', 'bestPractice'],
              },
            },
          },
          required: ['score12', 'percentage', 'overallVerdict', 'recommendations', 'perTaskFeedback'],
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const evaluation = JSON.parse(rawText) as TestEvaluationResult;

      const logEntry = recordTeacherLog({
        studentName: studentName.trim() || 'Учень',
        studentGroup: studentGroup.trim() || 'Група 1',
        mode: 'tester',
        topicOrAction: topic,
        difficultyLabel: difficultyLabelUk(difficulty),
        scoreOrResult: `${evaluation.score12}/12 (${evaluation.percentage}%)`,
        aiRiskPercent: null,
        summary: evaluation.overallVerdict,
        details: {
          recommendations: evaluation.recommendations,
        },
      });

      res.json({ evaluation, logEntry });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // =========================================================
  // 3. AI-WRITTEN CODE / PLAGIARISM DETECTOR
  // =========================================================
  app.post('/api/plagiarism/analyze', async (req: Request, res: Response) => {
    try {
      const {
        studentName = 'Учень',
        studentGroup = 'Група 1',
        code = '',
        taskDescription = '',
      } = req.body as {
        studentName?: string;
        studentGroup?: string;
        code?: string;
        taskDescription?: string;
      };

      if (!code.trim()) {
        res.status(400).json({ error: 'Вставте код Python для перевірки на ознаки генерації ШІ.' });
        return;
      }

      const ai = getGeminiClient();
      const numberedCode = code
        .split('\n')
        .map((line, i) => `${i + 1}: ${line}`)
        .join('\n');

      const prompt = [
        'Ти — експерт з академічної доброчесності та аналізу стилометрії коду Python у школі/університеті.',
        'Проаналізуй поданий код на предмет того, чи містить він фрагменти, написані штучним інтелектом (ChatGPT, Claude, Copilot тощо).',
        'Звертай увагу на:',
        '- Нехарактерно академічні або шаблонні коментарі (наприклад, "# Initialize the dictionary", "# Handle edge cases", ідеально вирівняні Google-style docstrings у базових шкільних задачах)',
        '- Надмірно узагальнені анотації типів (typing.List, Optional, Dict) там, де учень вирішує просту задачу',
        '- Змішування стилів (наприклад, в одній частині коду змінні транслітом a, spysok, а в іншій — ідеальний англійський корпоративний паттерн з list comprehension і обробкою винятків)',
        '- Типові кліше LLM (наприклад, конструкція `if __name__ == "__main__": main()` у найпростішій вправі, шаблонні повідомлення користувачу)',
        'Важливо: не вважати сам чистий простий код автоматично ШІ-кодом. Якщо код виглядає як звичайна учнівська робота — чесно вкажи низьку ймовірність (0–25%).',
        taskDescription ? `Умова завдання:\n${taskDescription}\n` : '',
        `Код (з номерами рядків):\n\`\`\`python\n${numberedCode}\n\`\`\``,
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await generateContentSmart(ai, {
        contents: prompt,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            aiProbability: { type: Type.INTEGER, description: '0 to 100' },
            verdict: { type: Type.STRING, description: 'human | mixed | ai_generated' },
            verdictLabel: { type: Type.STRING },
            summary: { type: Type.STRING },
            flaggedFragments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lineStart: { type: Type.INTEGER },
                  lineEnd: { type: Type.INTEGER },
                  codeFragment: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  confidence: { type: Type.STRING, description: 'high | medium | low' },
                },
                required: ['lineStart', 'lineEnd', 'codeFragment', 'reason', 'confidence'],
              },
            },
            studentSignals: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            oralCheckQuestions: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'aiProbability',
            'verdict',
            'verdictLabel',
            'summary',
            'flaggedFragments',
            'studentSignals',
            'oralCheckQuestions',
          ],
        },
      });

      const rawText = (response.text ?? '{}').trim();
      const analysis = JSON.parse(rawText) as PlagiarismAnalysisResult;

      const logEntry = recordTeacherLog({
        studentName: studentName.trim() || 'Учень',
        studentGroup: studentGroup.trim() || 'Група 1',
        mode: 'plagiarism',
        topicOrAction: taskDescription ? `Перевірка: ${taskDescription.slice(0, 48)}` : 'Перевірка коду на ШІ-плагіат',
        difficultyLabel: 'Академічна доброчесність',
        scoreOrResult: analysis.verdictLabel,
        aiRiskPercent: analysis.aiProbability,
        summary: analysis.summary,
        details: {
          code,
          oralCheckQuestions: analysis.oralCheckQuestions,
        },
      });

      res.json({ analysis, logEntry });
    } catch (err) {
      const formatted = formatGeminiError(err);
      res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // =========================================================
  // 4. TEACHER REAL-TIME TELEMETRY & SSE
  // =========================================================
  app.get('/api/teacher/logs', (_req: Request, res: Response) => {
    res.json({ logs: telemetryLogs });
  });

  app.get('/api/teacher/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    sseClients.add(res);
    res.write(`event: init\ndata: ${JSON.stringify({ logs: telemetryLogs })}\n\n`);

    const keepAlive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  app.post('/api/teacher/logs/mark-synced', (req: Request, res: Response) => {
    const { ids = [] } = req.body as { ids?: string[] };
    const idSet = new Set(ids);
    telemetryLogs = telemetryLogs.map((item) =>
      idSet.has(item.id) ? { ...item, syncedToSheets: true } : item
    );
    saveTelemetryLogs();
    broadcastSse('logs_updated', telemetryLogs);
    res.json({ ok: true, logs: telemetryLogs });
  });

  app.delete('/api/teacher/logs/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    telemetryLogs = telemetryLogs.filter((item) => item.id !== id);
    saveTelemetryLogs();
    broadcastSse('logs_updated', telemetryLogs);
    res.json({ ok: true });
  });

  // =========================================================
  // 5. GOOGLE WORKSPACE PROXY (DOCS, SHEETS, DRIVE.FILE)
  // =========================================================
  app.get('/api/workspace/files', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const q = encodeURIComponent(
        "(mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet') and trashed=false"
      );
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=20`;
      const gRes = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await gRes.json()) as { files?: unknown[]; error?: { message?: string } };
      if (!gRes.ok) {
        res.status(gRes.status).json({ error: data.error?.message ?? 'Не вдалося отримати список файлів Google Drive.' });
        return;
      }
      res.json({ files: data.files ?? [] });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Drive API error' });
    }
  });

  app.post('/api/workspace/docs/create', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { title = 'PyMentor — Навчальний зошит Python' } = req.body as { title?: string };

      const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title }),
      });

      const created = (await createRes.json()) as { documentId?: string; title?: string; error?: { message?: string } };
      if (!createRes.ok || !created.documentId) {
        res.status(createRes.status).json({ error: created.error?.message ?? 'Не вдалося створити Google Документ.' });
        return;
      }

      const starterTemplate = [
        'PyMentor — Навчальний документ курсу Python\n\n',
        '1. Практичне завдання для дебагінгу:\n',
        'Напишіть функцію average_positive(numbers), яка повертає середнє арифметичне лише додатних чисел у списку. Якщо додатних чисел немає — повертає 0.\n\n',
        'Код учня:\n',
        'def average_positive(numbers):\n',
        '    total = 0\n',
        '    for i in range(len(numbers) + 1):\n',
        '        if numbers[i] > 0:\n',
        '            total += numbers[i]\n',
        '    return total / len(numbers)\n\n',
        '2. Журнал менторських підказок, результатів тестування та перевірок:\n',
      ].join('');

      await fetch(`https://docs.googleapis.com/v1/documents/${created.documentId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: starterTemplate,
              },
            },
          ],
        }),
      });

      res.json({
        id: created.documentId,
        title: created.title ?? title,
        url: `https://docs.google.com/document/d/${created.documentId}/edit`,
        plainText: starterTemplate,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Docs API error' });
    }
  });

  app.get('/api/workspace/docs/:documentId', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { documentId } = req.params;
      const gRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await gRes.json()) as Record<string, unknown> & { error?: { message?: string } };
      if (!gRes.ok) {
        res.status(gRes.status).json({ error: data.error?.message ?? 'Не вдалося прочитати Google Документ.' });
        return;
      }

      const plainText = extractTextFromGoogleDoc(data);
      res.json({
        id: String(data.documentId ?? documentId),
        title: String(data.title ?? 'Google Документ'),
        url: `https://docs.google.com/document/d/${documentId}/edit`,
        plainText,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Docs read error' });
    }
  });

  app.post('/api/workspace/docs/:documentId/append', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { documentId } = req.params;
      const { text = '' } = req.body as { text?: string };
      if (!text.trim()) {
        res.status(400).json({ error: 'Порожній текст для запису в документ.' });
        return;
      }

      const docRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const docData = (await docRes.json()) as Record<string, unknown> & { error?: { message?: string } };
      if (!docRes.ok) {
        res.status(docRes.status).json({ error: docData.error?.message ?? 'Не вдалося отримати доступ до Google Документа.' });
        return;
      }

      const endIndex = getDocumentEndIndex(docData);
      const formattedBlock = `\n\n--- Запис PyMentor (${new Date().toLocaleString('uk-UA')}) ---\n${text.trim()}\n`;

      const updateRes = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: endIndex },
                text: formattedBlock,
              },
            },
          ],
        }),
      });

      const updateData = (await updateRes.json()) as { error?: { message?: string } };
      if (!updateRes.ok) {
        res.status(updateRes.status).json({ error: updateData.error?.message ?? 'Не вдалося оновити Google Документ.' });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Docs append error' });
    }
  });

  app.post('/api/workspace/sheets/create', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { title = 'PyMentor — Прогрес учнів (Таблиця вчителя)' } = req.body as { title?: string };
      const tabTitle = 'Прогрес учнів';

      const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          properties: { title },
          sheets: [
            {
              properties: {
                title: tabTitle,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          ],
        }),
      });

      const created = (await createRes.json()) as {
        spreadsheetId?: string;
        spreadsheetUrl?: string;
        properties?: { title?: string };
        sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
        error?: { message?: string };
      };

      if (!createRes.ok || !created.spreadsheetId) {
        res.status(createRes.status).json({ error: created.error?.message ?? 'Не вдалося створити Google Таблицю.' });
        return;
      }

      const headers = [
        [
          'Час',
          'Учень',
          'Група / Клас',
          'Режим',
          'Тема або дія',
          'Рівень складності',
          'Результат / Оцінка',
          'Ризик ШІ (%)',
          'Короткий підсумок',
        ],
      ];

      await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent(`'${tabTitle}'!A1:I1`)}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: headers }),
        }
      );

      res.json({
        id: created.spreadsheetId,
        title: created.properties?.title ?? title,
        url: created.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit`,
        tabs: (created.sheets ?? []).map((s) => ({
          sheetId: s.properties?.sheetId ?? 0,
          title: s.properties?.title ?? tabTitle,
        })),
        activeTab: tabTitle,
        previewRows: headers,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sheets create error' });
    }
  });

  app.get('/api/workspace/sheets/:spreadsheetId/meta', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { spreadsheetId } = req.params;
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const meta = (await metaRes.json()) as {
        spreadsheetId?: string;
        spreadsheetUrl?: string;
        properties?: { title?: string };
        sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
        error?: { message?: string };
      };

      if (!metaRes.ok || !meta.spreadsheetId) {
        res.status(metaRes.status).json({ error: meta.error?.message ?? 'Не вдалося прочитати метадані Google Таблиці.' });
        return;
      }

      const tabs = (meta.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId ?? 0,
        title: s.properties?.title ?? 'Sheet1',
      }));
      const requestedTab = typeof req.query.tab === 'string' && req.query.tab ? req.query.tab : tabs[0]?.title ?? 'Sheet1';

      let previewRows: string[][] = [];
      const valRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${requestedTab}'!A1:I15`)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (valRes.ok) {
        const valJson = (await valRes.json()) as { values?: string[][] };
        previewRows = valJson.values ?? [];
      }

      res.json({
        id: meta.spreadsheetId,
        title: meta.properties?.title ?? 'Google Таблиця',
        url: meta.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
        tabs,
        activeTab: requestedTab,
        previewRows,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sheets meta error' });
    }
  });

  app.post('/api/workspace/sheets/:spreadsheetId/append', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Потрібна авторизація Google.' });
      return;
    }

    try {
      const { spreadsheetId } = req.params;
      const { tabName, entries = [] } = req.body as {
        tabName?: string;
        entries?: TeacherLogEntry[];
      };

      if (!Array.isArray(entries) || entries.length === 0) {
        res.status(400).json({ error: 'Немає записів для синхронізації.' });
        return;
      }

      let targetTab = tabName;
      if (!targetTab) {
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const meta = (await metaRes.json()) as { sheets?: Array<{ properties?: { title?: string } }> };
        targetTab = meta.sheets?.[0]?.properties?.title ?? 'Sheet1';
      }

      const modeLabel = (mode: TeacherLogEntry['mode']) => {
        if (mode === 'mentor') return 'Ментор дебагінгу';
        if (mode === 'tester') return 'Тестувальник';
        return 'Антиплагіат (ШІ)';
      };

      const rows = entries.map((e) => [
        new Date(e.timestamp).toLocaleString('uk-UA'),
        e.studentName,
        e.studentGroup,
        modeLabel(e.mode),
        e.topicOrAction,
        e.difficultyLabel,
        e.scoreOrResult,
        e.aiRiskPercent !== null ? `${e.aiRiskPercent}%` : '—',
        e.summary,
      ]);

      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${targetTab}'!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: rows }),
        }
      );

      const appendJson = (await appendRes.json()) as { error?: { message?: string }; updates?: { updatedRows?: number } };
      if (!appendRes.ok) {
        res.status(appendRes.status).json({ error: appendJson.error?.message ?? 'Не вдалося записати рядки в Google Таблицю.' });
        return;
      }

      const syncedIds = new Set(entries.map((e) => e.id));
      telemetryLogs = telemetryLogs.map((item) =>
        syncedIds.has(item.id) ? { ...item, syncedToSheets: true } : item
      );
      saveTelemetryLogs();
      broadcastSse('logs_updated', telemetryLogs);

      res.json({
        ok: true,
        updatedRows: appendJson.updates?.updatedRows ?? rows.length,
        logs: telemetryLogs,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Sheets append error' });
    }
  });

  // =========================================================
  // VITE DEV MIDDLEWARE / PRODUCTION STATIC SERVING
  // =========================================================
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PyMentor server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
  process.exit(1);
});
