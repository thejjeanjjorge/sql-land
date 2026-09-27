import type { RuleChunk } from './schema'

/** A rule card that can be shown again after a wrong answer. */
export interface RuleCandidate {
  rule: RuleChunk
  levelNumber: number
  /** True for rules taught in the level the question belongs to. */
  isCurrentLevel: boolean
}

interface Concept {
  id: string
  /** Concepts in the same family are taught by the same kind of rule. */
  family: string
  /** Matched against uppercased SQL with literals and comments removed. */
  sql: RegExp | ((text: string) => boolean)
  /** Matched against a rule's title and body. Defaults to `sql` when it is a RegExp. */
  ruleText?: RegExp
  /** Count this concept for a rule only when its title or body names it, not its example. */
  textOnly?: boolean
}

/** Every query selects columns, so that family says little about a specific mistake. */
const FAMILY_WEIGHT: Record<string, number> = { columns: 0.5 }

/** Arithmetic between values, ignoring the * in SELECT *, COUNT(*) and table.*. */
function hasArithmetic(text: string): boolean {
  const withoutStars = text.replace(/\bSELECT\s+(?:DISTINCT\s+)?\*|\(\s*\*\s*\)|\.\*|,\s*\*/g, ' ')
  return /[\w)]\s*[-+*/%]\s*[\w(]/.test(withoutStars)
}

const CONCEPTS: Concept[] = [
  { id: 'select', family: 'columns', sql: /\bSELECT\b/, textOnly: true },
  { id: 'star', family: 'star', sql: /\bSELECT\s+\*/, ruleText: /\basterisk\b/i },
  { id: 'arithmetic', family: 'expression', sql: hasArithmetic, ruleText: /\bexpressions?\b|\bcalculat/i },
  { id: 'where', family: 'filter', sql: /\bWHERE\b/ },
  { id: 'and', family: 'logic', sql: /\bAND\b/ },
  { id: 'or', family: 'logic', sql: /\bOR\b/ },
  { id: 'not', family: 'logic', sql: /(?<!\bIS\s+)\bNOT\b(?!\s+(?:IN|EXISTS|LIKE|ILIKE|BETWEEN|NULL)\b)/ },
  { id: 'gte', family: 'comparison', sql: />=/ },
  { id: 'lte', family: 'comparison', sql: /<=/ },
  { id: 'ne', family: 'comparison', sql: /<>|!=/ },
  { id: 'gt', family: 'comparison', sql: /(?<![<>!-])>(?!=)/ },
  { id: 'lt', family: 'comparison', sql: /<(?![=>])/ },
  { id: 'orderBy', family: 'sort', sql: /\bORDER\s+BY\b/ },
  { id: 'asc', family: 'sort', sql: /\bASC\b/ },
  { id: 'desc', family: 'sort', sql: /\bDESC\b/ },
  { id: 'countStar', family: 'aggregate', sql: /\bCOUNT\s*\(\s*\*\s*\)/, ruleText: /\bCOUNT\b/ },
  { id: 'countColumn', family: 'aggregate', sql: /\bCOUNT\s*\(\s*(?!\*)/, ruleText: /\bCOUNT\(column\)/ },
  { id: 'sum', family: 'aggregate', sql: /\bSUM\s*\(/, ruleText: /\bSUM\b/ },
  { id: 'avg', family: 'aggregate', sql: /\bAVG\s*\(/, ruleText: /\bAVG\b/ },
  { id: 'min', family: 'aggregate', sql: /\bMIN\s*\(/, ruleText: /\bMIN\b/ },
  { id: 'max', family: 'aggregate', sql: /\bMAX\s*\(/, ruleText: /\bMAX\b/ },
  { id: 'groupBy', family: 'group', sql: /\bGROUP\s+BY\b/ },
  { id: 'having', family: 'having', sql: /\bHAVING\b/ },
  { id: 'distinct', family: 'distinct', sql: /\bDISTINCT\b/ },
  { id: 'limit', family: 'limit', sql: /\bLIMIT\b|\bOFFSET\b|\bFETCH\s+FIRST\b/ },
  { id: 'round', family: 'math', sql: /\bROUND\s*\(/, ruleText: /\bROUND\b/ },
  { id: 'cast', family: 'math', sql: /::|\bCAST\s*\(/, ruleText: /\bCAST\b|::|\bcast\b/ },
  { id: 'innerJoin', family: 'join', sql: /(?<!\b(?:LEFT|RIGHT|FULL|OUTER|CROSS)\s+)\bJOIN\b/ },
  { id: 'outerJoin', family: 'outerJoin', sql: /\b(?:LEFT|RIGHT|FULL)(?:\s+OUTER)?\s+JOIN\b/ },
  { id: 'like', family: 'pattern', sql: /\bI?LIKE\b/ },
  { id: 'in', family: 'membership', sql: /\bIN\s*\(/, ruleText: /\bIN\b/ },
  { id: 'between', family: 'membership', sql: /\bBETWEEN\b/ },
  { id: 'isNull', family: 'nulls', sql: /\bIS\s+(?:NOT\s+)?NULL\b/ },
  { id: 'coalesce', family: 'nulls', sql: /\bCOALESCE\b/ },
  { id: 'nullif', family: 'nulls', sql: /\bNULLIF\b/ },
  { id: 'case', family: 'case', sql: /\bCASE\b/ },
  { id: 'filterAggregate', family: 'filterAggregate', sql: /\bFILTER\s*\(/, ruleText: /\bFILTER\b/ },
  { id: 'subquery', family: 'subquery', sql: /\(\s*SELECT\b/, ruleText: /\bsubquer(?:y|ies)\b/i },
  { id: 'exists', family: 'exists', sql: /\bEXISTS\b/ },
  { id: 'notIn', family: 'notIn', sql: /\bNOT\s+IN\b/ },
  { id: 'with', family: 'cte', sql: /\bWITH\b(?!\s+RECURSIVE)/ },
  { id: 'recursive', family: 'recursive', sql: /\bWITH\s+RECURSIVE\b/ },
  { id: 'over', family: 'window', sql: /\bOVER\s*\(/, ruleText: /\bOVER\b|\bwindow\b/i },
  { id: 'partitionBy', family: 'window', sql: /\bPARTITION\s+BY\b/ },
  { id: 'frame', family: 'window', sql: /\b(?:ROWS|RANGE)\s+BETWEEN\b/ },
  { id: 'ranking', family: 'ranking', sql: /\b(?:ROW_NUMBER|DENSE_RANK|RANK|NTILE)\s*\(/, ruleText: /\b(?:ROW_NUMBER|DENSE_RANK|RANK|NTILE)\b/ },
  { id: 'lagLead', family: 'lagLead', sql: /\b(?:LAG|LEAD)\s*\(/, ruleText: /\b(?:LAG|LEAD)\b/ },
  { id: 'union', family: 'setOps', sql: /\bUNION\b/ },
  { id: 'intersect', family: 'setOps', sql: /\bINTERSECT\b/ },
  { id: 'except', family: 'setOps', sql: /\bEXCEPT\b/ },
  { id: 'dateLiteral', family: 'dates', sql: /\b(?:DATE|TIMESTAMP)\s*''/, ruleText: /\bdates?\b|\btimestamps?\b/i },
  { id: 'dateTrunc', family: 'dates', sql: /\bDATE_TRUNC\b/, ruleText: /\bdate_trunc\b/i },
  { id: 'extract', family: 'dates', sql: /\bEXTRACT\b|\bDATE_PART\b/, ruleText: /\bEXTRACT\b|\bdate_part\b/i },
  { id: 'interval', family: 'dates', sql: /\bINTERVAL\b/, ruleText: /\binterval\b/i },
  { id: 'series', family: 'series', sql: /\bGENERATE_SERIES\b/, ruleText: /\bgenerate_series\b/i },
  { id: 'stringAgg', family: 'strings', sql: /\bSTRING_AGG\b/, ruleText: /\bstring_agg\b/i },
  { id: 'stringFunction', family: 'strings', sql: /\|\||\b(?:CONCAT|UPPER|LOWER|LENGTH|SUBSTRING|SPLIT_PART|TRIM|REPLACE)\s*\(/ },
]

/** Remove comments and quoted text so keywords inside values are not counted. */
function stripSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, ' IDENT ')
    .toUpperCase()
    // The AND inside BETWEEN x AND y is part of the range, not a logical AND.
    .replace(/\bBETWEEN\b([\s\S]*?)\bAND\b/g, 'BETWEEN $1 ')
}

function matches(concept: Concept, text: string): boolean {
  return typeof concept.sql === 'function' ? concept.sql(text) : concept.sql.test(text)
}

function sqlConcepts(sql: string, forRuleExample = false): Set<string> {
  const text = stripSql(sql)
  return new Set(CONCEPTS
    .filter((concept) => !(forRuleExample && concept.textOnly) && matches(concept, text))
    .map((concept) => concept.id))
}

function familiesOf(conceptIds: Iterable<string>): Set<string> {
  const families = new Set<string>()
  for (const id of conceptIds) {
    const concept = CONCEPTS.find((item) => item.id === id)
    if (concept) families.add(concept.family)
  }
  return families
}

/** Families a rule teaches, read from its example SQL and the keywords in its text. */
function ruleFamilies(rule: RuleChunk): Set<string> {
  const text = `${rule.title} ${rule.body}`
  const fromText = CONCEPTS
    .filter((concept) => {
      const pattern = concept.ruleText ?? (concept.sql instanceof RegExp ? concept.sql : undefined)
      return pattern?.test(text)
    })
    .map((concept) => concept.id)
  return familiesOf([...fromText, ...(rule.example ? sqlConcepts(rule.example, true) : [])])
}

function overlap(families: Set<string>, covered: Set<string>): number {
  let total = 0
  for (const family of families) if (covered.has(family)) total += FAMILY_WEIGHT[family] ?? 1
  return total
}

interface ScoredRule {
  candidate: RuleCandidate
  /** How much of the learner's specific mistake the rule covers. */
  diagnostic: number
}

/**
 * Pick the rule card that best explains a wrong answer.
 *
 * Concepts the reference query uses but the learner's SQL lacks weigh most,
 * then concepts the learner used that the reference does not (DESC instead of
 * ASC, OR instead of AND), then concepts the reference uses at all. Narrower
 * rules win ties over rules that also cover unrelated concepts.
 *
 * Rules from the question's own level come first. An earlier level's rule is
 * chosen only when the mistake involves something the current level does not
 * teach, such as a forgotten ORDER BY in a grouping lesson.
 */
export function findRelatedRule(
  candidates: RuleCandidate[],
  learnerSql: string,
  referenceSql: string,
): RuleCandidate | null {
  if (!candidates.length || !referenceSql.trim()) return null
  const learner = sqlConcepts(learnerSql)
  const reference = sqlConcepts(referenceSql)
  const missing = familiesOf([...reference].filter((id) => !learner.has(id)))
  const extra = familiesOf([...learner].filter((id) => !reference.has(id)))
  const used = familiesOf(reference)

  function pickBest(pool: RuleCandidate[]): ScoredRule | null {
    let best: ScoredRule | null = null
    let bestScore = 0
    let bestUnrelated = Infinity
    for (const candidate of pool) {
      const covered = ruleFamilies(candidate.rule)
      const diagnostic = 3 * overlap(missing, covered) + 2 * overlap(extra, covered)
      const score = diagnostic + overlap(used, covered)
      if (score === 0) continue
      const unrelated = [...covered].filter((family) => !used.has(family) && !extra.has(family)).length
      if (score > bestScore || (score === bestScore && unrelated < bestUnrelated)) {
        best = { candidate, diagnostic }
        bestScore = score
        bestUnrelated = unrelated
      }
    }
    return best
  }

  const current = pickBest(candidates.filter((candidate) => candidate.isCurrentLevel))
  const hasSpecificMistake = missing.size > 0 || extra.size > 0
  if (current && (current.diagnostic > 0 || !hasSpecificMistake)) return current.candidate
  const earlier = pickBest(candidates.filter((candidate) => !candidate.isCurrentLevel))
  if (earlier && earlier.diagnostic > (current?.diagnostic ?? 0)) return earlier.candidate
  return current?.candidate ?? earlier?.candidate ?? null
}
