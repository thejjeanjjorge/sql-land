import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { MotionButton, MotionFeedback, MotionReveal } from '@motion-for-agents/react'
import { PostgreSQL, sql } from '@codemirror/lang-sql'
import { monoEditorTheme } from './editorTheme'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Code2,
  Database,
  FileCode,
  GripVertical,
  Lightbulb,
  Play,
  RotateCcw,
} from 'lucide-react'
import type { AnswerOption, Exercise, ExerciseOption } from './content/schema'
import { instantiateIfParameterized } from './content/parameterize'
import { findRelatedRule, type RuleCandidate } from './content/ruleMatcher'
import { gradeScalar, gradeSql, runSql, type QueryResult } from './engine/sqlEngine'
import RelatedRuleCard from './RelatedRuleCard'

type Mode = 'practice' | 'exam' | 'review'

interface QuestionPlayerProps {
  question: Exercise
  mode: Mode
  number: number
  total: number
  onAttempt: (correct: boolean) => void
  onContinue: (correct: boolean, answer: string) => void
  onReveal?: () => void
  /** Rule cards that can be shown again after a wrong answer (not used in exams). */
  ruleCandidates?: RuleCandidate[]
}

type Feedback = { correct: boolean; title: string; detail: string }

const KIND_LABELS: Record<Exercise['kind'], string> = {
  write: 'Write a query',
  choose: 'Choose the query',
  complete: 'Complete the query',
  fix: 'Fix the query',
  answer: 'Explore and answer',
  predict: 'Predict the result',
  match: 'Match the output',
  bug: 'Spot the logic bug',
  order: 'Order the clauses',
  explain: 'Explain the query',
  refactor: 'Refactor the query',
}

function shuffledOptions<T extends { id: string }>(questionId: string, source: T[]): T[] {
  const options = [...source]
  for (let index = options.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[options[index], options[swapIndex]] = [options[swapIndex], options[index]]
  }

  if (options.length > 1) {
    try {
      const key = `sql-land-choice-order:${questionId}`
      const previous = window.localStorage.getItem(key)
      if (previous === options.map((option) => option.id).join(',')) {
        options.push(options.shift()!)
      }
      window.localStorage.setItem(key, options.map((option) => option.id).join(','))
    } catch {
      // Shuffling still works when browser storage is unavailable.
    }
  }
  return options
}

function shuffleClauses(clauses: string[]): string[] {
  if (clauses.length <= 1) return [...clauses]
  const shuffled = [...clauses]
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    if (shuffled.some((c, i) => c !== clauses[i])) break
  }
  return shuffled
}

function displayCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="result-table-wrap">
      <table className="result-table">
        <thead>
          <tr>{result.columns.map((column, index) => <th key={`${column}-${index}`}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.length ? result.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className={cell === null ? 'null-cell' : undefined}>{displayCell(cell)}</td>)}
            </tr>
          )) : (
            <tr><td colSpan={Math.max(result.columns.length, 1)} className="empty-result">Query returned no rows</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export default function QuestionPlayer({
  question: rawQuestion,
  mode,
  number,
  total,
  onAttempt,
  onContinue,
  onReveal,
  ruleCandidates,
}: QuestionPlayerProps) {
  const question = useMemo(() => instantiateIfParameterized(rawQuestion), [rawQuestion])
  const [query, setQuery] = useState(question.starterSql ?? '')
  const [answer, setAnswer] = useState('')
  const [blanks, setBlanks] = useState<string[]>(() => Array(Math.max(0, (question.templateParts?.length ?? 1) - 1)).fill(''))
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [options] = useState(() => shuffledOptions<AnswerOption | ExerciseOption>(
    question.id,
    question.kind === 'predict' || question.kind === 'explain'
      ? question.answerOptions ?? []
      : question.options ?? [],
  ))
  const [orderedClauses, setOrderedClauses] = useState<string[]>(() => {
    return question.kind === 'order' && question.clauses ? shuffleClauses(question.clauses) : []
  })
  const [draggedClauseIndex, setDraggedClauseIndex] = useState<number | null>(null)
  const [target, setTarget] = useState<QueryResult | null>(null)
  const [targetError, setTargetError] = useState<string | null>(null)
  const [showHint, setShowHint] = useState(false)
  const [failedChecks, setFailedChecks] = useState(0)
  const [solutionRevealed, setSolutionRevealed] = useState(false)
  const [running, setRunning] = useState<'run' | 'check' | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  // Kept separate from feedback, which clears on every edit, so the rule stays visible while retrying.
  const [relatedRule, setRelatedRule] = useState<RuleCandidate | null>(null)
  const extensions = useMemo(() => [sql({ dialect: PostgreSQL })], [])

  const predictedTable = useMemo(() => {
    if (question.kind !== 'predict' || !question.starterSql) return null
    const match = /\bFROM\s+([a-zA-Z_]+)/i.exec(question.starterSql)
    return match ? match[1] : null
  }, [question.kind, question.starterSql])

  const [showPredictTable, setShowPredictTable] = useState(false)
  const [predictTableData, setPredictTableData] = useState<QueryResult | null>(null)
  const [loadingPredictTable, setLoadingPredictTable] = useState(false)

  async function handleTogglePredictTable() {
    if (!predictedTable) return
    if (showPredictTable) {
      setShowPredictTable(false)
      return
    }
    if (predictTableData) {
      setShowPredictTable(true)
      return
    }
    setLoadingPredictTable(true)
    try {
      const output = await runSql(`SELECT * FROM ${predictedTable} LIMIT 10;`)
      if (output.result) setPredictTableData(output.result)
      setShowPredictTable(true)
    } finally {
      setLoadingPredictTable(false)
    }
  }

  useEffect(() => {
    if (question.kind === 'order' && question.clauses) {
      setOrderedClauses(shuffleClauses(question.clauses))
    }
  }, [question])

  useEffect(() => {
    if (question.kind !== 'match' || !question.solutionSql) return
    let active = true
    void runSql(question.solutionSql).then((output) => {
      if (!active) return
      setTarget(output.result ?? null)
      setTargetError(output.error ?? null)
    })
    return () => { active = false }
  }, [question])

  const isChoice = question.kind === 'choose' || question.kind === 'predict' || question.kind === 'explain'
  const isPredict = question.kind === 'predict'
  const isExplain = question.kind === 'explain'
  const isAnswer = question.kind === 'answer'
  const isComplete = question.kind === 'complete'
  const isOrder = question.kind === 'order'
  const isRefactor = question.kind === 'refactor'
  const isFrozen = solutionRevealed || Boolean(feedback?.correct) ||
    (isChoice && feedback !== null) || (mode === 'exam' && feedback !== null)
  const canContinue = isFrozen
  const currentSql = isComplete
    ? (question.templateParts ?? []).reduce((text, part, index) => text + part + (blanks[index] ?? ''), '')
    : isOrder
      ? orderedClauses.join('\n')
      : query
  const canSubmit = isChoice
    ? Boolean(selectedOption)
    : isAnswer
      ? Boolean(answer.trim())
      : isComplete
        ? blanks.length > 0 && blanks.every((blank) => blank.trim().length > 0)
        : isOrder
          ? orderedClauses.length > 0
          : Boolean(currentSql.trim())
  // Exploring must not wait for the answer box: 'answer' questions run SQL before an answer exists.
  const canRun = !isChoice && (isComplete ? canSubmit : Boolean(currentSql.trim()))

  /** The rule card that best matches what is wrong with the submitted answer. */
  function ruleForMistake(): RuleCandidate | null {
    if (mode === 'exam' || !ruleCandidates?.length) return null
    const shownQuery = isPredict || isExplain
    const learnerSql = question.kind === 'choose'
      ? (options.find((option) => option.id === selectedOption) as { sql?: string } | undefined)?.sql ?? ''
      : shownQuery ? '' : currentSql
    const referenceSql = shownQuery
      ? question.starterSql ?? question.solutionSql ?? ''
      : question.solutionSql ?? ''
    return findRelatedRule(ruleCandidates, learnerSql, referenceSql)
  }

  function moveClause(fromIndex: number, delta: number) {
    if (isFrozen) return
    const toIndex = fromIndex + delta
    if (toIndex < 0 || toIndex >= orderedClauses.length) return
    const updated = [...orderedClauses]
    const [removed] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, removed)
    setOrderedClauses(updated)
    setFeedback(null)
  }

  function handleClauseDrop(targetIndex: number) {
    if (isFrozen || draggedClauseIndex === null || draggedClauseIndex === targetIndex) return
    const updated = [...orderedClauses]
    const [removed] = updated.splice(draggedClauseIndex, 1)
    updated.splice(targetIndex, 0, removed)
    setOrderedClauses(updated)
    setDraggedClauseIndex(null)
    setFeedback(null)
  }

  async function handleRun() {
    if (!currentSql.trim() || running || isFrozen) return
    setRunning('run')
    setResult(null)
    setRunError(null)
    setFeedback(null)
    try {
      const output = await runSql(currentSql)
      setResult(output.result ?? null)
      setRunError(output.error ?? null)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Could not run this query.')
    } finally {
      setRunning(null)
    }
  }

  async function handleCheck() {
    if (!canSubmit || running || isFrozen) return
    setRunning('check')
    setRunError(null)
    // Clearing the old verdict lets every check announce and animate its own result.
    setFeedback(null)
    try {
      if (isChoice) {
        const output = isPredict
          ? await gradeScalar(
            (options.find((option) => option.id === selectedOption) as { value?: string })?.value ?? '',
            question.solutionSql ?? '',
          )
          : null
        const correct = isPredict
          ? Boolean(output?.correct)
          : selectedOption === (question.correctOptionId ?? question.correctAnswerId)
        setFeedback({
          correct,
          title: mode === 'exam' ? 'Answer recorded' : correct ? 'That is the one!' : 'Not quite',
          detail: mode === 'exam'
            ? 'The answer and explanation will appear when the exam ends.'
            : isPredict && !correct ? output?.detail ?? question.explanation : question.explanation,
        })
        setRelatedRule(correct ? null : ruleForMistake())
        onAttempt(correct)
        return
      }
      if (!question.solutionSql) {
        setFeedback({ correct: false, title: 'Answer unavailable', detail: 'This question is missing its answer query.' })
        return
      }
      if (isAnswer) {
        const output = await gradeScalar(answer, question.solutionSql)
        setFeedback({
          correct: output.correct,
          title: mode === 'exam' ? 'Answer recorded' : output.correct ? 'Nice work!' : 'Keep going',
          detail: mode === 'exam'
            ? 'The answer and explanation will appear when the exam ends.'
            : output.correct ? question.explanation : output.detail,
        })
        setRelatedRule(output.correct ? null : ruleForMistake())
        if (!output.correct && mode === 'practice') setFailedChecks((count) => count + 1)
        onAttempt(output.correct)
        return
      }
      const output = await gradeSql(
        currentSql,
        question.solutionSql,
        question.orderMatters,
        question.checkColumnNames,
        question.commonMistakes,
        question.requiredPatterns,
        question.forbiddenPatterns,
      )
      setResult(mode === 'exam' ? null : output.result ?? null)
      setFeedback({
        correct: output.correct,
        title: mode === 'exam' ? 'Answer recorded' : output.correct ? 'Nice work!' : 'Keep going',
        detail: mode === 'exam'
          ? 'The answer and explanation will appear when the exam ends.'
          : output.correct ? question.explanation : output.error ?? output.detail,
      })
      setRelatedRule(output.correct ? null : ruleForMistake())
      if (!output.correct && mode === 'practice') setFailedChecks((count) => count + 1)
      onAttempt(output.correct)
    } catch (error) {
      setFeedback({ correct: false, title: 'Could not check the answer', detail: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setRunning(null)
    }
  }

  function handleReset() {
    setQuery(question.starterSql ?? '')
    setAnswer('')
    setBlanks(Array(Math.max(0, (question.templateParts?.length ?? 1) - 1)).fill(''))
    if (question.kind === 'order' && question.clauses) {
      setOrderedClauses(shuffleClauses(question.clauses))
    }
    setResult(null)
    setRunError(null)
    setFeedback(null)
  }

  function revealSolution() {
    setSolutionRevealed(true)
    setRelatedRule(ruleForMistake())
    onReveal?.()
    setFeedback({
      correct: false,
      title: 'Solution revealed',
      detail: 'Review this query, then continue. We will keep this question in your review queue.',
    })
  }

  function continueQuestion() {
    const submitted = isPredict
      ? (options.find((option) => option.id === selectedOption) as { label?: string })?.label ?? ''
      : isExplain
        ? (options.find((option) => option.id === selectedOption) as { label?: string })?.label ?? ''
        : question.kind === 'choose'
          ? (options.find((option) => option.id === selectedOption) as { sql?: string })?.sql ?? ''
          : isAnswer ? answer : currentSql
    onContinue(Boolean(feedback?.correct), submitted)
  }

  return (
    <section className="question-card">
      <div className="question-topline">
        <div className="eyebrow"><Code2 size={15} /> {KIND_LABELS[question.kind]}</div>
        <span className="question-counter">{mode === 'exam' ? 'Exam' : mode === 'review' ? 'Review' : 'Practice'} {number} / {total}</span>
      </div>
      <h2>{question.title}</h2>
      <p className="question-prompt">{question.prompt}</p>

      {(isPredict || isExplain) && <pre className="shown-query">{question.starterSql}</pre>}
      {isPredict && predictedTable && (
        <div className="predict-table-helper">
          <button
            type="button"
            className="predict-table-btn"
            onClick={handleTogglePredictTable}
          >
            <Database size={14} />
            {loadingPredictTable
              ? 'Loading table…'
              : showPredictTable
                ? `Hide ${predictedTable} table`
                : `View ${predictedTable} table data`}
          </button>
          {showPredictTable && predictTableData && (
            <MotionReveal className="predict-table-preview">
              <div className="predict-table-caption">
                Sample rows from <code>{predictedTable}</code>:
              </div>
              <ResultTable result={predictTableData} />
            </MotionReveal>
          )}
        </div>
      )}
      {isRefactor && (question.originalSql || question.starterSql) && (
        <div className="refactor-original-box">
          <div className="refactor-original-header">
            <FileCode size={16} />
            <strong>Original query to refactor</strong>
            <span className="refactor-tag">Rewrite using CTE</span>
          </div>
          <pre className="shown-query">{question.originalSql ?? question.starterSql}</pre>
        </div>
      )}
      {question.kind === 'match' && (
        <div className="target-output">
          <strong>Target output</strong>
          {target ? <ResultTable result={target} /> : <p>{targetError ?? 'Loading result…'}</p>}
        </div>
      )}
      {(question.requiredPatterns?.length || question.forbiddenPatterns?.length) && (
        <div className="constraint-list">
          {question.requiredPatterns?.map((item) => <span key={`required-${item.label}`}>Use {item.label}</span>)}
          {question.forbiddenPatterns?.map((item) => <span key={`forbidden-${item.label}`}>Avoid {item.label}</span>)}
        </div>
      )}

      {isChoice ? (
        <div className="choice-list" role="radiogroup" aria-label={isPredict ? 'Predict the result' : isExplain ? 'Explain the query' : 'Choose a SQL query'}>
          {options.map((option) => (
            <MotionButton
              key={option.id}
              className={`choice-option ${selectedOption === option.id ? 'selected' : ''}`}
              role="radio"
              aria-checked={selectedOption === option.id}
              disabled={Boolean(isFrozen)}
              onClick={() => { setSelectedOption(option.id); setFeedback(null) }}
            >
              <span className="choice-radio">{selectedOption === option.id && <Check size={14} />}</span>
              {isExplain ? (
                <span className="explain-option-text">{'label' in option ? option.label : 'sql' in option ? option.sql : ''}</span>
              ) : (
                <code>{'sql' in option ? option.sql : option.label}</code>
              )}
            </MotionButton>
          ))}
        </div>
      ) : isComplete ? (
        <div className="complete-editor" aria-label="Complete the missing SQL fragments">
          {(question.templateParts ?? []).map((part, index) => (
            <div key={index}>
              {part && <pre>{part}</pre>}
              {index < blanks.length && (
                <input
                  type="text"
                  value={blanks[index]}
                  placeholder={question.blankLabels?.[index] ?? `Blank ${index + 1}`}
                  aria-label={question.blankLabels?.[index] ?? `SQL blank ${index + 1}`}
                  disabled={Boolean(isFrozen)}
                  onChange={(event) => {
                    const updated = [...blanks]
                    updated[index] = event.target.value
                    setBlanks(updated)
                    setFeedback(null)
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ) : isOrder ? (
        <div className="parsons-editor" aria-label="Reorder the SQL clauses">
          <div className="parsons-instructions">
            <span>Reorder the clauses below into the correct SQL execution order (drag or use arrows):</span>
          </div>
          <div className="parsons-clause-list">
            {orderedClauses.map((clause, index) => (
              <div
                key={`${clause}-${index}`}
                className={`parsons-clause-tile ${draggedClauseIndex === index ? 'dragging' : ''}`}
                draggable={!isFrozen}
                onDragStart={() => setDraggedClauseIndex(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleClauseDrop(index)}
              >
                <span className="parsons-drag-handle" title="Drag to reorder">
                  <GripVertical size={16} />
                </span>
                <span className="parsons-clause-index">{index + 1}</span>
                <code className="parsons-clause-code">{clause}</code>
                <div className="parsons-clause-actions">
                  <button
                    type="button"
                    className="clause-arrow-button"
                    disabled={index === 0 || Boolean(isFrozen)}
                    onClick={() => moveClause(index, -1)}
                    aria-label={`Move clause ${index + 1} up`}
                    title="Move up"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className="clause-arrow-button"
                    disabled={index === orderedClauses.length - 1 || Boolean(isFrozen)}
                    onClick={() => moveClause(index, 1)}
                    aria-label={`Move clause ${index + 1} down`}
                    title="Move down"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="assembled-preview">
            <div className="assembled-header">
              <Code2 size={14} />
              <span>Assembled SQL query:</span>
            </div>
            <pre>{currentSql}</pre>
          </div>
        </div>
      ) : (
        <div className="code-editor" aria-label="SQL editor">
          <div className="editor-bar"><span className="editor-dot" /><span>query.sql</span><span className="editor-dialect">PostgreSQL</span></div>
          <CodeMirror
            value={query}
            height="210px"
            theme={monoEditorTheme}
            extensions={extensions}
            editable={!isFrozen}
            onChange={(value) => { setQuery(value); setFeedback(null) }}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
          />
        </div>
      )}

      {isAnswer && (
        <label className="short-answer-label">
          Your answer
          <input
            type="text"
            value={answer}
            placeholder="Type the value you found"
            disabled={Boolean(isFrozen)}
            onChange={(event) => { setAnswer(event.target.value); setFeedback(null) }}
          />
        </label>
      )}

      <div className="question-actions">
        {mode !== 'exam' && (
          <button className="text-button" type="button" onClick={() => setShowHint(!showHint)}>
            <Lightbulb size={17} /> {showHint ? 'Hide hint' : 'Show hint'}
          </button>
        )}
        {!isChoice && <button className="text-button" type="button" onClick={handleReset} disabled={Boolean(running) || Boolean(isFrozen)}><RotateCcw size={16} /> Reset</button>}
        <span className="action-spacer" />
        {!isChoice && <MotionButton className="secondary-button" onClick={handleRun} disabled={!canRun || Boolean(running) || Boolean(isFrozen)}><Play size={16} /> {running === 'run' ? 'Running…' : 'Run query'}</MotionButton>}
        <MotionButton
          className="primary-button"
          onClick={handleCheck}
          disabled={!canSubmit || Boolean(running) || Boolean(isFrozen)}
          title={isAnswer && !answer.trim() ? 'Type the value you found in “Your answer” to check it' : undefined}
        >
          <Check size={17} /> {running === 'check' ? 'Checking…' : 'Check answer'}
        </MotionButton>
      </div>

      {mode === 'practice' && !isChoice && failedChecks >= 3 && !isFrozen && (
        <MotionReveal className="solution-offer">
          <p>Stuck after {failedChecks} checks? You can study the answer and revisit this question later.</p>
          <MotionButton className="secondary-button" onClick={revealSolution}>
            Show solution
          </MotionButton>
        </MotionReveal>
      )}

      {showHint && mode !== 'exam' && (
        <MotionReveal className="hint-box">
          <Lightbulb size={18} />
          <div><strong>A little nudge</strong><p>{question.hint}</p></div>
        </MotionReveal>
      )}
      {runError && (
        <MotionFeedback kind="error" className="feedback-box incorrect">
          <CircleHelp size={19} /><div><strong>SQL error</strong><p>{runError}</p></div>
        </MotionFeedback>
      )}
      {feedback && (
        <MotionFeedback
          kind={mode === 'exam' ? 'info' : feedback.correct ? 'success' : 'error'}
          className={`feedback-box ${mode === 'exam' ? 'neutral' : feedback.correct ? 'correct' : 'incorrect'}`}
        >
          <span className="feedback-icon">
            {mode !== 'exam' && feedback.correct ? <Check size={18} /> : <CircleHelp size={18} />}
          </span>
          <div><strong>{feedback.title}</strong><p>{feedback.detail}</p></div>
        </MotionFeedback>
      )}
      {relatedRule && !feedback?.correct && <MotionReveal><RelatedRuleCard match={relatedRule} /></MotionReveal>}

      {solutionRevealed && question.solutionSql && (
        <MotionReveal className="revealed-solution">
          <strong>Reference query</strong>
          <pre>{question.solutionSql}</pre>
          <p>{question.explanation}</p>
        </MotionReveal>
      )}

      {result && <div className="results-section"><div className="results-heading"><span>Query results</span><small>{result.rows.length} {result.rows.length === 1 ? 'row' : 'rows'}</small></div><ResultTable result={result} /></div>}

      {canContinue && (
        <MotionReveal className="continue-row">
          <MotionButton className="primary-button" onClick={continueQuestion}>
            {mode === 'exam' ? number === total ? 'See exam result' : 'Next exam question'
              : mode === 'review' ? number === total ? 'Finish review' : 'Next review'
              : number === total ? 'Finish practice' : 'Next challenge'}
            <ArrowRight size={17} />
          </MotionButton>
        </MotionReveal>
      )}
    </section>
  )
}
