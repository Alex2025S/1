export type AppTab = 'mentor' | 'tester' | 'plagiarism' | 'teacher';

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ChatMessage {
  id: string;
  role: 'student' | 'mentor';
  content: string;
  timestamp: string;
  meta?: {
    errorType?: string;
    detectedConcept?: string;
    bestPracticeTip?: string;
  };
}

export interface MentorStarterPreset {
  id: string;
  title: string;
  topic: string;
  level: DifficultyLevel;
  code: string;
  errorLog: string;
  studentQuestion: string;
}

export interface TestTask {
  id: string;
  type: 'find_bug' | 'predict_output' | 'fix_logic';
  title: string;
  prompt: string;
  codeSnippet: string;
  hint: string;
  expectedConcept: string;
}

export interface TestTaskFeedback {
  taskId: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  explanation: string;
  bestPractice: string;
}

export interface TestEvaluationResult {
  score12: number;
  percentage: number;
  overallVerdict: string;
  recommendations: string[];
  perTaskFeedback: TestTaskFeedback[];
}

export interface FlaggedAiFragment {
  lineStart: number;
  lineEnd: number;
  codeFragment: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface PlagiarismAnalysisResult {
  aiProbability: number;
  verdict: 'human' | 'mixed' | 'ai_generated';
  verdictLabel: string;
  summary: string;
  flaggedFragments: FlaggedAiFragment[];
  studentSignals: string[];
  oralCheckQuestions: string[];
}

export interface TeacherLogEntry {
  id: string;
  timestamp: string;
  studentName: string;
  studentGroup: string;
  mode: 'mentor' | 'tester' | 'plagiarism';
  topicOrAction: string;
  difficultyLabel: string;
  scoreOrResult: string;
  aiRiskPercent: number | null;
  summary: string;
  details: {
    code?: string;
    errorLog?: string;
    mentorHint?: string;
    bestPractice?: string;
    recommendations?: string[];
    oralCheckQuestions?: string[];
  };
  syncedToSheets: boolean;
}

export interface WorkspaceDocInfo {
  id: string;
  title: string;
  url: string;
  plainText?: string;
}

export interface WorkspaceSheetTab {
  sheetId: number;
  title: string;
}

export interface WorkspaceSheetInfo {
  id: string;
  title: string;
  url: string;
  tabs: WorkspaceSheetTab[];
  activeTab: string;
  previewRows?: string[][];
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
}

export interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  description: string;
  targetLabel: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
}
