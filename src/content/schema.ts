export type SkillId = 'select' | 'filter' | 'sort' | 'aggregate' | 'join'
  | 'distinct' | 'conditions' | 'nulls' | 'case' | 'outerJoin' | 'subquery'
  | 'cte' | 'dates' | 'windowRank' | 'windowTrend' | 'sets' | 'capstone';

export type ExerciseKind = 'write' | 'choose' | 'complete' | 'fix' | 'answer' | 'predict' | 'match' | 'bug' | 'order' | 'explain' | 'refactor';

export interface ExerciseOption {
  id: string;
  sql: string;
}

export interface AnswerOption {
  id: string;
  label: string;
  value?: string;
}

export interface SqlPattern {
  pattern: string;
  label: string;
}

export interface ParamDefinition {
  pick?: (string | number)[];
  fromSql?: string;
}

export type ExerciseParams = Record<string, ParamDefinition>;

export interface Exercise {
  id: string;
  kind: ExerciseKind;
  skill: SkillId;
  title: string;
  prompt: string;
  hint: string;
  explanation: string;
  solutionSql?: string;
  starterSql?: string;
  /** Text surrounding each blank. There must be one more part than blankLabels. */
  templateParts?: string[];
  blankLabels?: string[];
  blankAnswers?: string[];
  options?: ExerciseOption[];
  correctOptionId?: string;
  answerOptions?: AnswerOption[];
  correctAnswerId?: string;
  /** Scrambled clauses for Parsons problems ('order' kind). Given in the correct solution order. */
  clauses?: string[];
  /** Optional original SQL for refactoring exercises before the learner rewrites it */
  originalSql?: string;
  orderMatters?: boolean;
  /** Check output aliases and column names. Defaults to true. */
  checkColumnNames?: boolean;
  commonMistakes?: { sql: string; feedback: string }[];
  requiredPatterns?: SqlPattern[];
  forbiddenPatterns?: SqlPattern[];
  difficulty?: 'warmup' | 'core' | 'stretch' | 'boss';
  /** Parameterized template definitions for dynamic variation across sessions */
  params?: ExerciseParams;
  /** Actual values substituted for this specific question instance */
  resolvedValues?: Record<string, string | number>;
}

export interface RuleChunk {
  title: string;
  body: string;
  example?: string;
}

export interface Level {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  skills: SkillId[];
  rules: RuleChunk[];
  exercises: Exercise[];
  exam: Exercise[];
  /** Number drawn from the exam pool for each attempt. */
  examDrawCount?: number;
  passCount: number;
}
