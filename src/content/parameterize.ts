import type { Exercise, ExerciseParams } from './schema';

/** Replaces all instances of `{paramName}` in text with the parameter value. */
export function resolveTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      return String(values[key]);
    }
    return match;
  });
}

/** Compute the Cartesian product of all parameter value options. */
export function cartesianCombinations(
  paramOptions: Record<string, (string | number)[]>,
): Record<string, string | number>[] {
  const keys = Object.keys(paramOptions);
  if (keys.length === 0) return [{}];

  let combinations: Record<string, string | number>[] = [{}];

  for (const key of keys) {
    const values = paramOptions[key];
    const next: Record<string, string | number>[] = [];
    for (const combo of combinations) {
      for (const val of values) {
        next.push({ ...combo, [key]: val });
      }
    }
    combinations = next;
  }

  return combinations;
}

/**
 * Pick parameter values. If a seed/number is given, pick deterministically;
 * otherwise pick at random from the param definitions.
 */
export function pickRandomParamValues(
  params: ExerciseParams,
  seed?: number,
): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  const keys = Object.keys(params);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const def = params[key];
    const pool = def.pick && def.pick.length > 0 ? def.pick : [];
    if (pool.length === 0) continue;

    const index = seed !== undefined
      ? Math.abs(Math.floor(seed + i * 31)) % pool.length
      : Math.floor(Math.random() * pool.length);
    result[key] = pool[index];
  }

  return result;
}

/**
 * Creates a concrete Exercise instance by resolving template variables `{param}`
 * in all user-facing text, SQL strings, blanks, and choices.
 */
export function instantiateExercise(
  exercise: Exercise,
  values: Record<string, string | number>,
): Exercise {
  const resolve = (text: string | undefined): string =>
    text ? resolveTemplate(text, values) : '';

  return {
    ...exercise,
    resolvedValues: values,
    title: resolve(exercise.title),
    prompt: resolve(exercise.prompt),
    hint: resolve(exercise.hint),
    explanation: resolve(exercise.explanation),
    solutionSql: exercise.solutionSql ? resolve(exercise.solutionSql) : undefined,
    starterSql: exercise.starterSql ? resolve(exercise.starterSql) : undefined,
    originalSql: exercise.originalSql ? resolve(exercise.originalSql) : undefined,
    clauses: exercise.clauses?.map((c) => resolveTemplate(c, values)),
    templateParts: exercise.templateParts?.map((part) => resolveTemplate(part, values)),
    blankAnswers: exercise.blankAnswers?.map((ans) => resolveTemplate(ans, values)),
    options: exercise.options?.map((opt) => ({
      ...opt,
      sql: resolveTemplate(opt.sql, values),
    })),
    answerOptions: exercise.answerOptions?.map((opt) => ({
      ...opt,
      label: resolveTemplate(opt.label, values),
      value: opt.value !== undefined ? resolveTemplate(opt.value, values) : undefined,
    })),
    commonMistakes: exercise.commonMistakes?.map((mistake) => ({
      sql: resolveTemplate(mistake.sql, values),
      feedback: resolveTemplate(mistake.feedback, values),
    })),
  };
}

/**
 * If the exercise defines `params` and has not already been resolved,
 * instantiates it with picked values; otherwise returns the exercise unchanged.
 */
export function instantiateIfParameterized(exercise: Exercise, seed?: number): Exercise {
  if (!exercise.params || Object.keys(exercise.params).length === 0) {
    return exercise;
  }
  if (exercise.resolvedValues) {
    return exercise;
  }
  const picked = pickRandomParamValues(exercise.params, seed);
  return instantiateExercise(exercise, picked);
}
