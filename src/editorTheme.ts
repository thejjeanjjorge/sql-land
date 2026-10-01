import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Monochrome editor theme driven by the CSS tokens in styles.css, so it follows light/dark.
const base = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--code)' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--strong)' },
  '.cm-gutters': { color: 'var(--comment)', backgroundColor: 'var(--code)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--sunken)' },
  '.cm-activeLineGutter': { color: 'var(--text)', backgroundColor: 'var(--sunken)' },
  '.cm-tooltip': { color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--line)' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { color: 'var(--on-ink)', backgroundColor: 'var(--ink)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier], fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: 'var(--str)' },
  { tag: [t.number, t.bool, t.null], color: 'var(--text)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--text)', fontWeight: '600' },
])

export const monoEditorTheme = [base, syntaxHighlighting(highlight)]
