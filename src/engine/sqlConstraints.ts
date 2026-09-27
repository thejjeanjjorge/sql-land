import type { SqlPattern } from '../content/schema';

/** Hide comments and quoted values before checking a required SQL construct. */
export function codeOnly(sql: string): string {
  let output = '';
  let index = 0;
  while (index < sql.length) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      index = end < 0 ? sql.length : end;
      output += ' ';
    } else if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      output += ' ';
    } else if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index++];
      while (index < sql.length) {
        if (sql[index] === quote) {
          index++;
          if (sql[index] === quote) { index++; continue; }
          break;
        }
        index++;
      }
      output += ' ';
    } else if (sql[index] === '$') {
      const tag = /^\$[a-z_0-9]*\$/i.exec(sql.slice(index))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, index + tag.length);
        if (end >= 0) {
          index = end + tag.length;
          output += ' ';
          continue;
        }
      }
      output += sql[index++];
    } else {
      output += sql[index++];
    }
  }
  return output;
}

export function constraintError(
  sql: string,
  required: SqlPattern[] = [],
  forbidden: SqlPattern[] = [],
): string | null {
  const source = codeOnly(sql);
  for (const item of required) {
    if (!new RegExp(item.pattern, 'i').test(source)) return `This challenge requires: ${item.label}.`;
  }
  for (const item of forbidden) {
    if (new RegExp(item.pattern, 'i').test(source)) return `This challenge does not allow: ${item.label}.`;
  }
  return null;
}
