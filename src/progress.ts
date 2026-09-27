import type { SkillId } from './content/schema'

export interface ExerciseRepetition {
  box: number // 1, 2, 3, or 4
  dueDate: string // ISO date string
  lastReviewedAt?: string
}

export interface SkillStat {
  attempts: number
  correct: number
  lastPracticedAt: string
  lastCorrectAt?: string
  /** Rolling window of the last ~20 attempts for responsive accuracy */
  recentAttempts?: boolean[]
}

export interface Progress {
  completedExerciseIds: string[]
  queuedReviewExerciseIds: string[]
  passedLevelIds: string[]
  /** Levels whose practice set was worked through to the end, even with misses. */
  practiceFinishedLevelIds: string[]
  examAttempts: Record<string, number>
  lastExamQuestionIds: Record<string, string[]>
  skillStats: Partial<Record<SkillId, SkillStat>>
  /** Spaced repetition state (Leitner boxes) per exercise */
  exerciseRepetition: Record<string, ExerciseRepetition>
}

export const LEITNER_INTERVAL_DAYS: Record<number, number> = {
  1: 1,  // Box 1: due tomorrow
  2: 3,  // Box 2: due in 3 days
  3: 7,  // Box 3: due in 1 week
  4: 21, // Box 4: due in 3 weeks
}

const STORAGE_KEY_V2 = 'sql-land-progress-v2'
const STORAGE_KEY_V1 = 'sql-land-progress-v1'

export const emptyProgress: Progress = {
  completedExerciseIds: [],
  queuedReviewExerciseIds: [],
  passedLevelIds: [],
  practiceFinishedLevelIds: [],
  examAttempts: {},
  lastExamQuestionIds: {},
  skillStats: {},
  exerciseRepetition: {},
}

function migrateV1ToV2(v1: Record<string, unknown>): Progress {
  const completedExerciseIds = Array.isArray(v1.completedExerciseIds) ? (v1.completedExerciseIds as string[]) : []
  const queuedReviewExerciseIds = Array.isArray(v1.queuedReviewExerciseIds) ? (v1.queuedReviewExerciseIds as string[]) : []
  const passedLevelIds = Array.isArray(v1.passedLevelIds) ? (v1.passedLevelIds as string[]) : []
  const examAttempts = v1.examAttempts && typeof v1.examAttempts === 'object' ? (v1.examAttempts as Record<string, number>) : {}
  const lastExamQuestionIds = v1.lastExamQuestionIds && typeof v1.lastExamQuestionIds === 'object'
    ? (v1.lastExamQuestionIds as Record<string, string[]>) : {}
  const rawStats = v1.skillStats && typeof v1.skillStats === 'object'
    ? (v1.skillStats as Record<string, SkillStat>) : {}

  const skillStats: Partial<Record<SkillId, SkillStat>> = {}
  for (const [skillKey, stat] of Object.entries(rawStats)) {
    if (!stat || typeof stat !== 'object') continue
    const attempts = Number(stat.attempts) || 0
    const correct = Number(stat.correct) || 0
    let recentAttempts: boolean[] = []
    if (Array.isArray(stat.recentAttempts)) {
      recentAttempts = stat.recentAttempts.slice(-20)
    } else if (attempts > 0) {
      const recentCount = Math.min(attempts, 20)
      const correctRatio = attempts > 0 ? correct / attempts : 0
      const approxCorrect = Math.round(recentCount * correctRatio)
      recentAttempts = [
        ...Array(approxCorrect).fill(true),
        ...Array(recentCount - approxCorrect).fill(false),
      ]
    }
    skillStats[skillKey as SkillId] = {
      attempts,
      correct,
      lastPracticedAt: String(stat.lastPracticedAt || new Date().toISOString()),
      lastCorrectAt: stat.lastCorrectAt ? String(stat.lastCorrectAt) : undefined,
      recentAttempts,
    }
  }

  const exerciseRepetition: Record<string, ExerciseRepetition> = {}
  const now = new Date().toISOString()
  for (const id of queuedReviewExerciseIds) {
    exerciseRepetition[id] = {
      box: 1,
      dueDate: now,
    }
  }

  const migrated: Progress = {
    completedExerciseIds,
    queuedReviewExerciseIds,
    passedLevelIds,
    practiceFinishedLevelIds: [],
    examAttempts,
    lastExamQuestionIds,
    skillStats,
    exerciseRepetition,
  }

  try {
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated))
  } catch {
    // Keep working even if storage write fails
  }

  return migrated
}

export function loadProgress(): Progress {
  try {
    const rawV2 = window.localStorage.getItem(STORAGE_KEY_V2)
    if (rawV2) {
      const saved = JSON.parse(rawV2) as Partial<Progress>
      return {
        completedExerciseIds: Array.isArray(saved.completedExerciseIds) ? saved.completedExerciseIds : [],
        queuedReviewExerciseIds: Array.isArray(saved.queuedReviewExerciseIds) ? saved.queuedReviewExerciseIds : [],
        passedLevelIds: Array.isArray(saved.passedLevelIds) ? saved.passedLevelIds : [],
        practiceFinishedLevelIds: Array.isArray(saved.practiceFinishedLevelIds) ? saved.practiceFinishedLevelIds : [],
        examAttempts: saved.examAttempts && typeof saved.examAttempts === 'object' ? saved.examAttempts : {},
        lastExamQuestionIds: saved.lastExamQuestionIds && typeof saved.lastExamQuestionIds === 'object'
          ? saved.lastExamQuestionIds : {},
        skillStats: saved.skillStats && typeof saved.skillStats === 'object' ? saved.skillStats : {},
        exerciseRepetition: saved.exerciseRepetition && typeof saved.exerciseRepetition === 'object'
          ? saved.exerciseRepetition : {},
      }
    }

    const rawV1 = window.localStorage.getItem(STORAGE_KEY_V1)
    if (rawV1) {
      const savedV1 = JSON.parse(rawV1) as Record<string, unknown>
      return migrateV1ToV2(savedV1)
    }

    return emptyProgress
  } catch {
    return emptyProgress
  }
}

export function saveProgress(progress: Progress): void {
  try {
    window.localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(progress))
  } catch {
    // Practice remains usable if private browsing or storage limits block persistence.
  }
}

export function recordAttempt(progress: Progress, skill: SkillId, correct: boolean): Progress {
  const current = progress.skillStats[skill]
  const now = new Date().toISOString()
  const recent = [...(current?.recentAttempts ?? []), correct].slice(-20)
  return {
    ...progress,
    skillStats: {
      ...progress.skillStats,
      [skill]: {
        attempts: (current?.attempts ?? 0) + 1,
        correct: (current?.correct ?? 0) + Number(correct),
        lastPracticedAt: now,
        lastCorrectAt: correct ? now : current?.lastCorrectAt,
        recentAttempts: recent,
      },
    },
  }
}

/**
 * Update Leitner box spaced repetition state for an exercise.
 * - Wrong answer or revealed solution: drops to Box 1 (due in 1 day / tomorrow).
 * - Correct answer: moves up one box (max Box 4, due in 3, 7, or 21 days).
 */
export function recordRepetition(progress: Progress, exerciseId: string, correct: boolean): Progress {
  const existing = progress.exerciseRepetition[exerciseId]
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  let nextBox = 1
  let intervalDays = 1

  if (correct) {
    const currentBox = existing?.box ?? 1
    nextBox = Math.min(currentBox + 1, 4)
    intervalDays = LEITNER_INTERVAL_DAYS[nextBox] ?? 1
  } else {
    nextBox = 1
    intervalDays = 1
  }

  const dueDate = new Date(now + intervalDays * 86_400_000).toISOString()
  const repetition: ExerciseRepetition = {
    box: nextBox,
    dueDate,
    lastReviewedAt: nowIso,
  }

  const queuedReviewExerciseIds = correct
    ? progress.queuedReviewExerciseIds.filter((id) => id !== exerciseId)
    : progress.queuedReviewExerciseIds.includes(exerciseId)
      ? progress.queuedReviewExerciseIds
      : [...progress.queuedReviewExerciseIds, exerciseId]

  return {
    ...progress,
    queuedReviewExerciseIds,
    exerciseRepetition: {
      ...progress.exerciseRepetition,
      [exerciseId]: repetition,
    },
  }
}

/** Check if an exercise is due for spaced review. */
export function isExerciseDue(repetition?: ExerciseRepetition, isQueued = false): boolean {
  if (isQueued) return true
  if (!repetition) return false
  const due = Date.parse(repetition.dueDate)
  if (Number.isNaN(due)) return false
  return due <= Date.now()
}

/** Compute accuracy over the rolling window of the last ~20 attempts (returns 0-100, or null if no attempts). */
export function recentAccuracy(stat?: SkillStat): number | null {
  if (!stat) return null
  if (stat.recentAttempts && stat.recentAttempts.length > 0) {
    const correctCount = stat.recentAttempts.filter(Boolean).length
    return Math.round((correctCount / stat.recentAttempts.length) * 100)
  }
  if (stat.attempts > 0) {
    return Math.round((stat.correct / stat.attempts) * 100)
  }
  return null
}

export function relativePracticeDate(iso?: string): string {
  if (!iso) return 'Never practiced'
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return 'Never practiced'
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000))
  if (days === 0) return 'Practiced today'
  if (days === 1) return 'Practiced yesterday'
  return `Practiced ${days} days ago`
}

export function reviewStatus(stat?: SkillStat): 'new' | 'focus' | 'due' | 'fresh' {
  if (!stat || (!stat.recentAttempts?.length && !stat.attempts)) return 'new'
  const acc = recentAccuracy(stat)
  if (acc !== null && acc < 70) return 'focus'
  if (stat.lastPracticedAt && Date.now() - Date.parse(stat.lastPracticedAt) >= 7 * 86_400_000) return 'due'
  return 'fresh'
}
