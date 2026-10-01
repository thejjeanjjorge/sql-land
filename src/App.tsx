import { useEffect, useState } from 'react'
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, CheckCircle2, ChevronRight,
  CircleHelp, Code2, GraduationCap, LayoutDashboard, LockKeyhole,
  RotateCcw, Sparkles, Target, Trophy,
} from 'lucide-react'
import { LEVELS as FOUNDATION_LEVELS, SKILL_LABELS } from './content/levels'
import { ADVANCED_LEVELS } from './content/advancedLevels'
import type { Exercise, Level, SkillId } from './content/schema'
import { findRelatedRule, type RuleCandidate } from './content/ruleMatcher'
import QuestionPlayer from './QuestionPlayer'
import RelatedRuleCard from './RelatedRuleCard'
import SchemaPanel from './SchemaPanel'
import {
  loadProgress,
  recordAttempt,
  recordRepetition,
  isExerciseDue,
  recentAccuracy,
  relativePracticeDate,
  reviewStatus,
  saveProgress,
  type Progress,
} from './progress'

type View = 'home' | 'lesson' | 'review' | 'reviewSession'
type LessonPhase = 'rules' | 'practice' | 'examIntro' | 'exam' | 'examResults'

const LEVELS = [...FOUNDATION_LEVELS, ...ADVANCED_LEVELS]

const SKILLS = Object.keys(SKILL_LABELS) as SkillId[]
const EXAM_QUESTION_COUNT = 4

function examQuestionCount(level: Level): number {
  return Math.min(level.examDrawCount ?? EXAM_QUESTION_COUNT, level.exam.length)
}

const LEVEL_INDEX_BY_QUESTION = new Map<string, number>(
  LEVELS.flatMap((level, index) => [...level.exercises, ...level.exam].map((question) => [question.id, index] as const)),
)
const ruleCandidateCache = new Map<number, RuleCandidate[]>()

/** Rules from the question's own level and every level before it. */
function ruleCandidatesFor(questionId: string): RuleCandidate[] {
  const levelIndex = LEVEL_INDEX_BY_QUESTION.get(questionId)
  if (levelIndex === undefined) return []
  let candidates = ruleCandidateCache.get(levelIndex)
  if (!candidates) {
    candidates = LEVELS.slice(0, levelIndex + 1).flatMap((level, index) =>
      level.rules.map((rule) => ({ rule, levelNumber: level.number, isCurrentLevel: index === levelIndex })))
    ruleCandidateCache.set(levelIndex, candidates)
  }
  return candidates
}

/**
 * True once the learner has worked through the whole practice set. Progress saved
 * before practiceFinishedLevelIds existed counts as finished when the last question
 * was answered.
 */
function isPracticeFinished(progress: Progress, level: Level): boolean {
  const last = level.exercises[level.exercises.length - 1]
  return progress.practiceFinishedLevelIds.includes(level.id) ||
    level.exercises.every((question) => progress.completedExerciseIds.includes(question.id)) ||
    Boolean(last && (progress.completedExerciseIds.includes(last.id) || last.id in progress.exerciseRepetition))
}

/** A level the learner has already worked on no longer needs to open on its rule cards. */
function hasStartedLevel(progress: Progress, level: Level): boolean {
  return progress.passedLevelIds.includes(level.id) || isPracticeFinished(progress, level) ||
    level.exercises.some((question) =>
      progress.completedExerciseIds.includes(question.id) || question.id in progress.exerciseRepetition)
}

interface ExamAnswer {
  question: Exercise
  correct: boolean
  answer: string
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex], result[index]]
  }
  return result
}

function drawExamQuestions(pool: Exercise[], count: number, previousIds: string[]): Exercise[] {
  const previous = new Set(previousIds)
  const unseen = shuffled(pool.filter((question) => !previous.has(question.id)))
  const seen = shuffled(pool.filter((question) => previous.has(question.id)))
  const writeQuestion = unseen.find((question) => question.kind === 'write') ??
    seen.find((question) => question.kind === 'write')
  const chosen = writeQuestion ? [writeQuestion] : []

  for (const question of [...unseen, ...seen]) {
    if (chosen.length >= count) break
    if (!chosen.some((item) => item.id === question.id)) chosen.push(question)
  }
  return shuffled(chosen)
}



function dueCountForSkill(progress: Progress, skill: SkillId): number {
  const queued = new Set(progress.queuedReviewExerciseIds)
  return LEVELS.flatMap((level) => [...level.exercises, ...level.exam])
    .filter((question) => question.skill === skill &&
      (queued.has(question.id) || isExerciseDue(progress.exerciseRepetition[question.id]))).length
}

function totalDueCount(progress: Progress): number {
  const unlocked = LEVELS.filter((_, index) => index === 0 || progress.passedLevelIds.includes(LEVELS[index - 1].id))
  const pool = unlocked.flatMap((level) =>
    progress.passedLevelIds.includes(level.id) ? [...level.exercises, ...level.exam] : level.exercises)
  const queued = new Set(progress.queuedReviewExerciseIds)
  return pool.filter((q) => queued.has(q.id) || isExerciseDue(progress.exerciseRepetition[q.id])).length
}

function leitnerBoxCounts(progress: Progress): { box1: number; box2: number; box3: number; box4: number } {
  const counts = { box1: 0, box2: 0, box3: 0, box4: 0 }
  for (const rep of Object.values(progress.exerciseRepetition)) {
    if (rep.box === 1) counts.box1++
    else if (rep.box === 2) counts.box2++
    else if (rep.box === 3) counts.box3++
    else if (rep.box === 4) counts.box4++
  }
  return counts
}

function selectReviewQuestions(progress: Progress, skill: SkillId): Exercise[] {
  const pool = LEVELS
    .filter((_, index) => index === 0 || progress.passedLevelIds.includes(LEVELS[index - 1].id))
    .flatMap((level) => progress.passedLevelIds.includes(level.id)
      ? [...level.exercises, ...level.exam] : level.exercises)
    .filter((question) => question.skill === skill)
  if (!pool.length) return []

  const queued = new Set(progress.queuedReviewExerciseIds)
  const isDue = (q: Exercise) => queued.has(q.id) || isExerciseDue(progress.exerciseRepetition[q.id])
  const due = shuffled(pool.filter(isDue))
  const other = shuffled(pool.filter((q) => !isDue(q)))
  return [...due, ...other].slice(0, Math.min(3, pool.length))
}

function selectMixedReviewQuestions(progress: Progress, count = 5): Exercise[] {
  const unlocked = LEVELS.filter((_, index) => index === 0 || progress.passedLevelIds.includes(LEVELS[index - 1].id))
  const pool = unlocked.flatMap((level) =>
    progress.passedLevelIds.includes(level.id) ? [...level.exercises, ...level.exam] : level.exercises)
  if (!pool.length) return []

  const queued = new Set(progress.queuedReviewExerciseIds)
  const isDue = (q: Exercise) => queued.has(q.id) || isExerciseDue(progress.exerciseRepetition[q.id])

  const dueQuestions = shuffled(pool.filter(isDue))
  const nonDueQuestions = pool.filter((q) => !isDue(q))

  const skillWeights: Partial<Record<SkillId, number>> = {}
  for (const skill of SKILLS) {
    const status = reviewStatus(progress.skillStats[skill])
    skillWeights[skill] = status === 'focus' ? 5 : status === 'due' ? 4 : status === 'new' ? 2 : 1
  }

  const chosen: Exercise[] = []
  const chosenIds = new Set<string>()

  const skillUsage: Partial<Record<SkillId, number>> = {}
  for (const q of dueQuestions) {
    if (chosen.length >= count) break
    const used = skillUsage[q.skill] ?? 0
    if (used < 2) {
      chosen.push(q)
      chosenIds.add(q.id)
      skillUsage[q.skill] = used + 1
    }
  }

  if (chosen.length < count && nonDueQuestions.length > 0) {
    const bySkill: Partial<Record<SkillId, Exercise[]>> = {}
    for (const q of nonDueQuestions) {
      if (!chosenIds.has(q.id)) {
        if (!bySkill[q.skill]) bySkill[q.skill] = []
        bySkill[q.skill]!.push(q)
      }
    }

    const availableSkills = Object.keys(bySkill) as SkillId[]
    while (chosen.length < count && availableSkills.length > 0) {
      const totalWeight = availableSkills.reduce((sum, s) => sum + (skillWeights[s] ?? 1), 0)
      let r = Math.random() * totalWeight
      let pickedSkill = availableSkills[0]
      for (const s of availableSkills) {
        r -= skillWeights[s] ?? 1
        if (r <= 0) {
          pickedSkill = s
          break
        }
      }

      const qList = bySkill[pickedSkill]!
      const q = qList.splice(Math.floor(Math.random() * qList.length), 1)[0]
      if (q) {
        chosen.push(q)
        chosenIds.add(q.id)
      }
      if (qList.length === 0) {
        const idx = availableSkills.indexOf(pickedSkill)
        if (idx >= 0) availableSkills.splice(idx, 1)
      }
    }
  }

  return shuffled(chosen)
}

function statusForSkill(progress: Progress, skill: SkillId) {
  const due = dueCountForSkill(progress, skill)
  if (due > 0) {
    return { text: `${due} due for review`, className: 'status-focus' }
  }
  const status = reviewStatus(progress.skillStats[skill])
  return {
    new: { text: 'New skill', className: 'status-new' },
    focus: { text: 'Needs practice', className: 'status-focus' },
    due: { text: 'Review due', className: 'status-due' },
    fresh: { text: 'On track', className: 'status-fresh' },
  }[status]
}

function LevelIcon({ level, passed, locked }: { level: Level; passed: boolean; locked: boolean }) {
  return <span className={`level-icon ${passed ? 'passed' : locked ? 'locked' : 'active'}`}>
    {passed ? <Check size={21} /> : locked ? <LockKeyhole size={19} /> : <span>{String(level.number).padStart(2, '0')}</span>}
  </span>
}

function App() {
  const [progress, setProgress] = useState<Progress>(loadProgress)
  const [view, setView] = useState<View>('home')
  const [selectedLevelId, setSelectedLevelId] = useState(LEVELS[0]?.id ?? '')
  const [phase, setPhase] = useState<LessonPhase>('rules')
  const [ruleIndex, setRuleIndex] = useState(0)
  const [practiceIndex, setPracticeIndex] = useState(0)
  const [examIndex, setExamIndex] = useState(0)
  const [examQuestions, setExamQuestions] = useState<Exercise[]>([])
  const [examAnswers, setExamAnswers] = useState<ExamAnswer[]>([])
  const [examResult, setExamResult] = useState<{ score: number; passed: boolean } | null>(null)
  const [examRound, setExamRound] = useState(0)
  const [isMixedReview, setIsMixedReview] = useState(false)
  const [reviewSkill, setReviewSkill] = useState<SkillId>('select')
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewRound, setReviewRound] = useState(0)
  const [reviewQuestions, setReviewQuestions] = useState<Exercise[]>([])
  const [showLevelRules, setShowLevelRules] = useState(false)

  useEffect(() => saveProgress(progress), [progress])

  const selectedLevel = LEVELS.find((level) => level.id === selectedLevelId) ?? LEVELS[0]
  const passedCount = LEVELS.filter((level) => progress.passedLevelIds.includes(level.id)).length
  const completedCount = LEVELS.flatMap((level) => level.exercises).filter((exercise) => progress.completedExerciseIds.includes(exercise.id)).length
  const totalExercises = LEVELS.reduce((total, level) => total + level.exercises.length, 0)
  const nextLevel = LEVELS.find((level) => !progress.passedLevelIds.includes(level.id)) ?? LEVELS[LEVELS.length - 1]
  const allPassed = passedCount === LEVELS.length
  function isLocked(level: Level): boolean {
    const index = LEVELS.findIndex((item) => item.id === level.id)
    return index > 0 && !progress.passedLevelIds.includes(LEVELS[index - 1].id)
  }

  function openLevel(level: Level) {
    if (isLocked(level)) return
    setSelectedLevelId(level.id)
    setRuleIndex(0)
    setShowLevelRules(false)
    setView('lesson')
    if (hasStartedLevel(progress, level)) resumeLevel(level)
    else setPhase('rules')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /** Go straight to where the learner left off: the exam once practice is done, otherwise practice. */
  function resumeLevel(level: Level) {
    if (!progress.passedLevelIds.includes(level.id) && isPracticeFinished(progress, level)) setPhase('examIntro')
    else startPractice(level)
  }

  function startPractice(level: Level = selectedLevel) {
    const index = level.exercises.findIndex((question) => !progress.completedExerciseIds.includes(question.id))
    setPracticeIndex(index >= 0 ? index : 0)
    setPhase('practice')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function recordQuestionAttempt(
    skill: SkillId,
    correct: boolean,
    exerciseId?: string,
    completeOnCorrect = false,
  ) {
    setProgress((current) => {
      let next = recordAttempt(current, skill, correct)
      if (exerciseId) {
        next = recordRepetition(next, exerciseId, correct)
      }
      const completedExerciseIds = correct && completeOnCorrect && exerciseId &&
        !next.completedExerciseIds.includes(exerciseId)
        ? [...next.completedExerciseIds, exerciseId] : next.completedExerciseIds
      return { ...next, completedExerciseIds }
    })
  }

  function queueQuestionForReview(questionId: string) {
    setProgress((current) => recordRepetition(current, questionId, false))
  }

  function advancePractice(correct: boolean) {
    if (!correct) queueQuestionForReview(selectedLevel.exercises[practiceIndex].id)
    if (practiceIndex + 1 < selectedLevel.exercises.length) {
      setPracticeIndex(practiceIndex + 1)
    } else {
      // Missed questions are already in the review queue, so the end of practice always leads to the exam.
      const levelId = selectedLevel.id
      setProgress((current) => current.practiceFinishedLevelIds.includes(levelId) ? current : {
        ...current,
        practiceFinishedLevelIds: [...current.practiceFinishedLevelIds, levelId],
      })
      setPhase('examIntro')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startExam() {
    const previous = progress.lastExamQuestionIds[selectedLevel.id] ?? []
    const questions = drawExamQuestions(selectedLevel.exam, examQuestionCount(selectedLevel), previous)
    setExamQuestions(questions)
    setExamIndex(0)
    setExamAnswers([])
    setExamResult(null)
    setExamRound((round) => round + 1)
    setProgress((current) => ({
      ...current,
      lastExamQuestionIds: {
        ...current.lastExamQuestionIds,
        [selectedLevel.id]: questions.map((question) => question.id),
      },
    }))
    setPhase('exam')
  }

  function advanceExam(correct: boolean, answer: string) {
    const answers = [...examAnswers, { question: examQuestions[examIndex], correct, answer }]
    setExamAnswers(answers)
    if (examIndex + 1 < examQuestions.length) {
      setExamIndex(examIndex + 1)
    } else {
      const score = answers.filter((item) => item.correct).length
      const passed = score >= selectedLevel.passCount
      setProgress((current) => ({
        ...current,
        examAttempts: { ...current.examAttempts, [selectedLevel.id]: (current.examAttempts[selectedLevel.id] ?? 0) + 1 },
        passedLevelIds: passed && !current.passedLevelIds.includes(selectedLevel.id)
          ? [...current.passedLevelIds, selectedLevel.id] : current.passedLevelIds,
      }))
      setExamResult({ score, passed })
      setPhase('examResults')
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startMixedReview() {
    setIsMixedReview(true)
    setReviewQuestions(selectMixedReviewQuestions(progress, 5))
    setReviewIndex(0)
    setReviewRound((round) => round + 1)
    setView('reviewSession')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function startReview(skill: SkillId) {
    setIsMixedReview(false)
    setReviewSkill(skill)
    setReviewQuestions(selectReviewQuestions(progress, skill))
    setReviewIndex(0)
    setReviewRound((round) => round + 1)
    setView('reviewSession')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function advanceReview(correct?: boolean) {
    if (correct === false) {
      const questionId = reviewQuestions[reviewIndex]?.id
      if (questionId) queueQuestionForReview(questionId)
    }
    if (reviewIndex + 1 < reviewQuestions.length) setReviewIndex(reviewIndex + 1)
    else setView('review')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function renderHome() {
    const dueCount = totalDueCount(progress)
    return <>
      <div className="page-eyebrow"><Sparkles size={16} /> Your learning space</div>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-tag">LEARN · PRACTICE · MASTER</div>
          <h1>Make SQL practice <em>stick.</em></h1>
          <p>Short lessons, different ways to solve, and a clear path forward. Practice a little, learn a lot.</p>
          <button
            className="hero-button"
            type="button"
            onClick={() => {
              if (dueCount > 0) startMixedReview()
              else if (allPassed) setView('review')
              else openLevel(nextLevel)
            }}
          >
            {dueCount > 0
              ? `Review due skills (${dueCount} due)`
              : allPassed
                ? 'Review your skills'
                : completedCount
                  ? 'Continue learning'
                  : 'Start learning'} <ArrowRight size={19} />
          </button>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="floating-sql-card"><span>SQL QUEST</span><code>SELECT <b>confidence</b><br />FROM practice<br />WHERE effort = <i>'daily'</i>;</code><div className="floating-card-bottom"><span className="green-pulse" /> query complete</div></div>
          <div className="floating-badge badge-one"><Check size={15} /> +1 skill</div>
          <div className="floating-badge badge-two">✦ Level up</div>
        </div>
      </section>

      <div className="stats-row">
        <div className="stat-card"><span className="stat-icon violet"><GraduationCap size={22} /></span><div><strong>{passedCount}<span> / {LEVELS.length}</span></strong><p>Levels passed</p></div></div>
        <div className="stat-card"><span className="stat-icon blue"><Code2 size={21} /></span><div><strong>{completedCount}<span> / {totalExercises}</span></strong><p>Questions solved</p></div></div>
        <div className="stat-card"><span className="stat-icon orange"><Target size={21} /></span><div><strong>{SKILLS.filter((skill) => progress.skillStats[skill]?.attempts).length}<span> / {SKILLS.length}</span></strong><p>Skills practiced</p></div></div>
        <div className="stat-card"><span className="stat-icon green"><CalendarClock size={21} /></span><div><strong>{dueCount}</strong><p>Questions due</p></div></div>
      </div>

      <div className="section-heading"><div><span className="section-kicker">YOUR PATH</span><h2>Learning levels</h2><p>Pass each level exam to unlock what comes next.</p></div><span className="section-count">{LEVELS.length} LEVELS</span></div>
      <div className="level-grid">
        {LEVELS.map((level) => {
          const locked = isLocked(level)
          const passed = progress.passedLevelIds.includes(level.id)
          const solved = level.exercises.filter((question) => progress.completedExerciseIds.includes(question.id)).length
          return <button key={level.id} className={`level-card ${locked ? 'is-locked' : ''} ${passed ? 'is-passed' : ''}`} type="button" onClick={() => openLevel(level)} disabled={locked}>
            <div className="level-card-top"><LevelIcon level={level} passed={passed} locked={locked} /><span className={`level-status ${passed ? 'passed' : locked ? 'locked' : 'available'}`}>{passed ? 'Passed' : locked ? 'Locked' : solved ? 'In progress' : 'Ready to start'}</span></div>
            <h3>{level.title}</h3><p>{level.subtitle}</p>
            <div className="level-card-footer">
              <span>{level.exercises.length} practices · {examQuestionCount(level)} exam questions</span>
              <ChevronRight size={19} />
            </div>
          </button>
        })}
      </div>

      <div className="formats-strip"><div><span className="section-kicker">VARIETY BUILT IN</span><h3>Different ways to practice</h3></div><div className="format-pills"><span>✎ Write a query</span><span>◎ Choose the code</span><span>▦ Fill the blanks</span><span>⚒ Fix the query</span><span>◈ Predict a result</span><span>⌕ Explore and answer</span><span>▤ Match output</span><span>⚑ Spot a logic bug</span><span>⇅ Clause shuffle</span><span>💬 Explain query</span><span>⚡ Refactor query</span></div></div>
    </>
  }

  function renderRules() {
    const rule = selectedLevel.rules[ruleIndex]
    return <div className="lesson-narrow">
      <div className="lesson-breadcrumb"><button type="button" onClick={() => setView('home')}><ArrowLeft size={16} /> Learning path</button><ChevronRight size={16} /><span>Level {selectedLevel.number}</span></div>
      <div className="lesson-heading"><span className="level-label">LEVEL {String(selectedLevel.number).padStart(2, '0')} · QUICK LESSON</span><h1>{selectedLevel.title}</h1><p>{selectedLevel.subtitle}</p></div>
      <div className="rules-progress"><span>Learn the rules</span><span>{ruleIndex + 1} of {selectedLevel.rules.length}</span></div>
      <div className="progress-track"><span style={{ width: `${((ruleIndex + 1) / selectedLevel.rules.length) * 100}%` }} /></div>
      <article className="rule-card"><div className="rule-icon"><BookOpen size={25} /></div><h2>{rule.title}</h2><p>{rule.body}</p>{rule.example && <div className="rule-example"><span>EXAMPLE</span><pre>{rule.example}</pre></div>}</article>
      <div className="rule-navigation"><button type="button" className="secondary-button" disabled={ruleIndex === 0} onClick={() => setRuleIndex(ruleIndex - 1)}><ArrowLeft size={17} /> Previous</button><div className="rule-dots">{selectedLevel.rules.map((_, index) => <span key={index} className={index === ruleIndex ? 'active' : ''} />)}</div><button type="button" className="primary-button" onClick={() => ruleIndex + 1 < selectedLevel.rules.length ? setRuleIndex(ruleIndex + 1) : startPractice()}>{ruleIndex + 1 < selectedLevel.rules.length ? 'Next rule' : 'Start practice'} <ArrowRight size={17} /></button></div>
      {hasStartedLevel(progress, selectedLevel) && (
        <div className="skip-rules-row">
          <button type="button" className="text-button" onClick={() => resumeLevel(selectedLevel)}>
            Skip to exercises <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  }

  function renderExercise() {
    const isExam = phase === 'exam'
    const question = isExam ? examQuestions[examIndex] : selectedLevel.exercises[practiceIndex]
    const number = isExam ? examIndex + 1 : practiceIndex + 1
    const total = isExam ? examQuestions.length : selectedLevel.exercises.length
    if (!question) return null
    return <>
      <div className="lesson-breadcrumb">
        <button type="button" onClick={() => setView('home')}><ArrowLeft size={16} /> Learning path</button>
        <ChevronRight size={16} />
        <span>{selectedLevel.title}</span>
        {!isExam && (
          <button type="button" className="breadcrumb-rules" aria-expanded={showLevelRules} onClick={() => setShowLevelRules(!showLevelRules)}>
            <BookOpen size={15} /> {showLevelRules ? 'Hide rules' : 'Rules'}
          </button>
        )}
      </div>
      {!isExam && showLevelRules && (
        <section className="level-rules-panel" aria-label={`Level ${selectedLevel.number} rules`}>
          {selectedLevel.rules.map((rule) => (
            <div className="level-rule" key={rule.title}>
              <strong>{rule.title}</strong>
              <p>{rule.body}</p>
              {rule.example && <pre>{rule.example}</pre>}
            </div>
          ))}
        </section>
      )}
      <div className="challenge-header">
        <div>
          <span className="level-label">
            LEVEL {String(selectedLevel.number).padStart(2, '0')} · {isExam ? 'LEVEL EXAM' : 'PRACTICE'}
          </span>
          <h1>{isExam ? 'Show what you know' : selectedLevel.title}</h1>
          <p>{isExam
            ? `Get ${selectedLevel.passCount} of ${total} right to unlock the next level.`
            : 'Try it your way. Run your SQL anytime to see what it returns.'}</p>
        </div>
        <div className="challenge-step">
          <strong>{String(number).padStart(2, '0')}</strong>
          <span> / {String(total).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="challenge-progress">{Array.from({ length: total }, (_, index) => <span key={index} className={index < number ? 'active' : ''} />)}</div>
      <div className="challenge-layout">
        <QuestionPlayer
          key={`${phase}-${question.id}-${examRound}`}
          question={question}
          mode={isExam ? 'exam' : 'practice'}
          number={number}
          total={total}
          onAttempt={(correct) => {
            recordQuestionAttempt(question.skill, correct, isExam ? undefined : question.id, !isExam)
            if (!correct && !isExam && question.kind === 'choose') {
              queueQuestionForReview(question.id)
            }
          }}
          onContinue={(correct, answer) => isExam
            ? advanceExam(correct, answer) : advancePractice(correct)}
          onReveal={isExam ? undefined : () => queueQuestionForReview(question.id)}
          ruleCandidates={isExam ? undefined : ruleCandidatesFor(question.id)}
        />
        <SchemaPanel />
      </div>
    </>
  }

  function renderExamIntro() {
    const missed = selectedLevel.exercises.filter((question) => !progress.completedExerciseIds.includes(question.id)).length
    return <div className="lesson-narrow">
      <div className="lesson-breadcrumb"><button type="button" onClick={() => setView('home')}><ArrowLeft size={16} /> Learning path</button><ChevronRight size={16} /><span>Level {selectedLevel.number} exam</span></div>
      <div className="exam-intro-card">
        <span className="exam-icon"><GraduationCap size={34} /></span>
        <span className="level-label">LEVEL {String(selectedLevel.number).padStart(2, '0')} COMPLETE</span>
        <h1>Ready for a quick exam?</h1>
        <p>
          You finished the practice questions. Answer at least {selectedLevel.passCount} of{' '}
          {examQuestionCount(selectedLevel)} questions correctly to unlock the next level.
        </p>
        <div className="exam-facts">
          <div><strong>{examQuestionCount(selectedLevel)}</strong><span>Questions</span></div>
          <div><strong>{selectedLevel.passCount}</strong><span>To pass</span></div>
          <div><strong>∞</strong><span>Retries</span></div>
        </div>
        {missed > 0 && (
          <p className="exam-intro-note">
            {missed} practice {missed === 1 ? 'question is' : 'questions are'} still unsolved.{' '}
            {missed === 1 ? 'It is' : 'They are'} saved in your review queue, or you can practice again first.
          </p>
        )}
        <div className="result-actions">
          <button type="button" className="primary-button" onClick={startExam}>
            Start level exam <ArrowRight size={18} />
          </button>
          <button type="button" className="secondary-button" onClick={() => startPractice()}>
            Practice again
          </button>
          <button type="button" className="secondary-button" onClick={() => { setRuleIndex(0); setPhase('rules') }}>
            Review rules
          </button>
        </div>
      </div>
    </div>
  }

  function renderExamResults() {
    if (!examResult) return null
    const nextIndex = LEVELS.findIndex((level) => level.id === selectedLevel.id) + 1
    const upcoming = LEVELS[nextIndex]
    return <div className="lesson-narrow">
      <div className="lesson-breadcrumb"><button type="button" onClick={() => setView('home')}><ArrowLeft size={16} /> Learning path</button><ChevronRight size={16} /><span>Exam result</span></div>
      <div className={`exam-result-card ${examResult.passed ? 'success' : 'retry'}`}>
        <span className="exam-icon">{examResult.passed ? <Trophy size={35} /> : <RotateCcw size={33} />}</span>
        <span className="level-label">{examResult.passed ? 'LEVEL PASSED' : 'KEEP PRACTICING'}</span>
        <h1>{examResult.passed ? 'You did it!' : 'One more try?'}</h1>
        <p>
          You got <strong>{examResult.score} of {examQuestions.length}</strong> questions right.{' '}
          {examResult.passed ? 'The next level is unlocked.'
            : `You need ${selectedLevel.passCount} correct answers to move on. Review the rules or try the exam again.`}
        </p>
        <div className="result-actions">
          {examResult.passed && upcoming ? (
            <button type="button" className="primary-button" onClick={() => openLevel(upcoming)}>
              Go to level {upcoming.number} <ArrowRight size={18} />
            </button>
          ) : examResult.passed ? (
            <button type="button" className="primary-button" onClick={() => setView('review')}>
              Review your skills <ArrowRight size={18} />
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={startExam}>
              Retry exam <ArrowRight size={18} />
            </button>
          )}
          <button type="button" className="secondary-button" onClick={() => { setRuleIndex(0); setPhase('rules') }}>
            Review rules
          </button>
        </div>
      </div>
      <section className="exam-answer-review" aria-label="Exam answer review">
        <h2>Review your answers</h2>
        {examAnswers.map(({ question, correct, answer }, index) => {
          const reference = question.kind === 'choose'
            ? question.options?.find((option) => option.id === question.correctOptionId)?.sql
            : question.solutionSql
          const shownQuery = question.kind === 'predict' || question.kind === 'explain'
          const relatedRule = correct ? null : findRelatedRule(
            ruleCandidatesFor(question.id),
            shownQuery || question.kind === 'answer' ? '' : answer,
            shownQuery ? question.starterSql ?? reference ?? '' : reference ?? '',
          )
          return (
            <article className="exam-answer-card" key={question.id}>
              <div className="exam-answer-heading">
                <span>Question {index + 1}</span>
                <strong className={correct ? 'is-correct' : 'is-incorrect'}>
                  {correct ? 'Correct' : 'Needs review'}
                </strong>
              </div>
              <h3>{question.title}</h3>
              <p>{question.prompt}</p>
              <span className="exam-answer-label">Your answer</span>
              <pre>{answer || 'No answer submitted'}</pre>
              <span className="exam-answer-label">Reference query</span>
              <pre>{reference ?? 'Reference query unavailable'}</pre>
              <p className="exam-answer-explanation">{question.explanation}</p>
              {relatedRule && <RelatedRuleCard match={relatedRule} />}
            </article>
          )
        })}
      </section>
    </div>
  }

  function renderReview() {
    const dueCount = totalDueCount(progress)
    const boxes = leitnerBoxCounts(progress)

    return <>
      <div className="page-eyebrow"><CalendarClock size={16} /> Your review space</div>
      <div className="review-header">
        <div>
          <h1>Keep your skills fresh.</h1>
          <p>
            Spaced repetition schedules questions as you practice. Mixed review draws across all unlocked skills,
            prioritizing what needs attention.
          </p>
        </div>
        <div className="review-summary">
          <strong>{dueCount}</strong>
          <span>{dueCount === 1 ? 'question due today' : 'questions due today'}</span>
        </div>
      </div>

      <section className="mixed-review-card" aria-label="Mixed skill review">
        <div className="mixed-review-info">
          <h2>Mixed Skill Review</h2>
          <p>
            A 5-question workout combining all your unlocked skills, prioritizing questions due today
            and skills needing practice.
          </p>
          <div className="leitner-boxes" aria-label="Spaced repetition box summary">
            <span className="leitner-box-pill">Box 1 (due 1d): <b>{boxes.box1}</b></span>
            <span className="leitner-box-pill">Box 2 (due 3d): <b>{boxes.box2}</b></span>
            <span className="leitner-box-pill">Box 3 (due 7d): <b>{boxes.box3}</b></span>
            <span className="leitner-box-pill">Box 4 (mastered 21d): <b>{boxes.box4}</b></span>
          </div>
        </div>
        <button type="button" className="primary-button" onClick={startMixedReview}>
          Start mixed review (5 questions) <ArrowRight size={17} />
        </button>
      </section>

      <div className="section-heading">
        <div>
          <span className="section-kicker">SKILL TRACKER</span>
          <h2>What to practice next</h2>
        </div>
        <span className="section-count">{SKILLS.length} SKILLS</span>
      </div>

      <div className="skill-grid">{SKILLS.map((skill) => {
        const stat = progress.skillStats[skill]
        const status = statusForSkill(progress, skill)
        const level = LEVELS.find((item) => item.skills.includes(skill))
        const locked = level ? isLocked(level) : true
        const acc = recentAccuracy(stat)
        const dueInSkill = dueCountForSkill(progress, skill)

        return (
          <div className={`skill-card ${locked ? 'is-locked' : ''}`} key={skill}>
            <div className="skill-card-top">
              <span className="skill-icon">{locked ? <LockKeyhole size={20} /> : <Code2 size={20} />}</span>
              <span className={`skill-status ${locked ? 'status-locked' : status.className}`}>
                {locked ? 'Locked' : status.text}
              </span>
            </div>
            <h3>{SKILL_LABELS[skill]}</h3>
            <p>{locked ? `Unlock level ${level?.number ?? ''} to practice this skill.` : relativePracticeDate(stat?.lastPracticedAt)}</p>
            <div className="skill-metrics">
              <span>{stat?.attempts ?? 0} total attempts</span>
              <span>{acc === null ? 'No accuracy yet' : `${acc}% recent accuracy`}</span>
            </div>
            {dueInSkill > 0 && (
              <p className="queued-count">{dueInSkill} {dueInSkill === 1 ? 'question' : 'questions'} due for review</p>
            )}
            <button type="button" className="skill-practice-button" disabled={locked} onClick={() => startReview(skill)}>
              {locked ? 'Unlock to review' : 'Review skill'} <ArrowRight size={16} />
            </button>
          </div>
        )
      })}</div>
    </>
  }

  function renderReviewSession() {
    const question = reviewQuestions[reviewIndex]
    if (!question) return <div className="lesson-narrow"><h1>No review questions yet</h1><button type="button" className="primary-button" onClick={() => setView('review')}>Back to review</button></div>
    return <>
      <div className="lesson-breadcrumb">
        <button type="button" onClick={() => setView('review')}><ArrowLeft size={16} /> Review</button>
        <ChevronRight size={16} />
        <span>{isMixedReview ? 'Mixed Review' : SKILL_LABELS[reviewSkill]}</span>
      </div>
      <div className="challenge-header">
        <div>
          <span className="level-label">
            {isMixedReview ? `MIXED SKILL REVIEW · SKILL: ${SKILL_LABELS[question.skill].toUpperCase()}` : 'SKILL REVIEW'}
          </span>
          <h1>{isMixedReview ? SKILL_LABELS[question.skill] : SKILL_LABELS[reviewSkill]}</h1>
          <p>
            {isMixedReview
              ? `Question ${reviewIndex + 1} of ${reviewQuestions.length} across your unlocked skills. Correct answers advance your Leitner box.`
              : 'A short refresher. Your answers update the practice date, accuracy, and spaced repetition box for this skill.'}
          </p>
        </div>
        <div className="challenge-step">
          <strong>{String(reviewIndex + 1).padStart(2, '0')}</strong>
          <span> / {String(reviewQuestions.length).padStart(2, '0')}</span>
        </div>
      </div>
      <div className="challenge-progress">{reviewQuestions.map((_, index) => <span key={index} className={index <= reviewIndex ? 'active' : ''} />)}</div>
      <div className="challenge-layout">
        <QuestionPlayer
          key={`review-${reviewRound}-${question.id}`}
          question={question}
          mode="review"
          number={reviewIndex + 1}
          total={reviewQuestions.length}
          onAttempt={(correct) => {
            recordQuestionAttempt(question.skill, correct, question.id)
            if (!correct && question.kind === 'choose') queueQuestionForReview(question.id)
          }}
          onContinue={advanceReview}
          ruleCandidates={ruleCandidatesFor(question.id)}
        />
        <SchemaPanel onSkip={advanceReview} />
      </div>
    </>
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => setView('home')}><span className="brand-icon"><svg width="26" height="26" viewBox="10 8 44 48" fill="none" aria-hidden="true" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round"><path d="M18 15v33h29" stroke="currentColor" /><path d="M30 15v21h17" stroke="currentColor" strokeOpacity={0.55} /></svg></span><span>SQL <b>LAND</b><small>Practice makes progress</small></span></button>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation"><button type="button" className={view === 'home' || view === 'lesson' ? 'active' : ''} onClick={() => setView('home')}><LayoutDashboard size={19} /> Learning path</button><button type="button" className={view === 'review' || view === 'reviewSession' ? 'active' : ''} onClick={() => setView('review')}><RotateCcw size={19} /> Review skills</button></nav>
      <div className="sidebar-label levels-label">YOUR LEVELS</div>
      <div className="sidebar-levels">{LEVELS.map((level) => { const locked = isLocked(level); const passed = progress.passedLevelIds.includes(level.id); return <button type="button" key={level.id} className={view === 'lesson' && selectedLevel.id === level.id ? 'current' : ''} disabled={locked} onClick={() => openLevel(level)}><span className={`sidebar-level-number ${passed ? 'done' : ''}`}>{passed ? <Check size={14} /> : locked ? <LockKeyhole size={13} /> : level.number}</span><span>{level.title}</span></button> })}</div>
      <div className="sidebar-footer"><div className="sidebar-progress-top"><span>Your progress</span><strong>{Math.round((passedCount / LEVELS.length) * 100)}%</strong></div><div className="sidebar-progress-track"><span style={{ width: `${(passedCount / LEVELS.length) * 100}%` }} /></div><p>{passedCount} of {LEVELS.length} levels passed</p></div>
    </aside>
    <div className="main-column"><header className="topbar"><span><span className="topbar-dot" /> Learn at your own pace</span><span className="saved-indicator"><CheckCircle2 size={16} /> Progress saved on this device</span></header><main className="page-content">{view === 'home' ? renderHome() : view === 'review' ? renderReview() : view === 'reviewSession' ? renderReviewSession() : phase === 'rules' ? renderRules() : phase === 'practice' || phase === 'exam' ? renderExercise() : phase === 'examIntro' ? renderExamIntro() : renderExamResults()}</main><footer className="app-footer"><span>SQL Land · a little practice goes a long way</span><span><CircleHelp size={15} /> PostgreSQL practice</span></footer></div>
  </div>
}

export default App
