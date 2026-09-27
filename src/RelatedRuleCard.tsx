import { BookOpen } from 'lucide-react'
import type { RuleCandidate } from './content/ruleMatcher'

/** Repeats the rule card that the learner's mistake relates to. */
export default function RelatedRuleCard({ match }: { match: RuleCandidate }) {
  return (
    <aside className="related-rule" aria-label="Rule to remember">
      <div className="related-rule-heading">
        <BookOpen size={15} />
        <span>Rule to remember{match.isCurrentLevel ? '' : ` · from level ${match.levelNumber}`}</span>
      </div>
      <strong>{match.rule.title}</strong>
      <p>{match.rule.body}</p>
      {match.rule.example && <pre>{match.rule.example}</pre>}
    </aside>
  )
}
