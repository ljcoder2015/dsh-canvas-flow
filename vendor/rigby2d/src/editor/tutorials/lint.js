// SPDX-License-Identifier: MIT OR Apache-2.0
// Lesson shape rules, shared by the coach, the arena and the tests.

/** Problems with a lesson's shape (an empty list when it is fine). */
export function lintLesson(lesson) {
  const problems = [];
  if (!lesson.id || !lesson.title || !lesson.steps?.length) problems.push(`${lesson.id ?? '?'}: needs an id, a title and steps`);
  (lesson.steps ?? []).forEach((s, i) => {
    const where = `${lesson.id} step ${i + 1}`;
    if (!s.text) problems.push(`${where}: no text`);
    // An action moves on by itself; an explanation has Next. Never both, never neither.
    if (!!s.done === !!s.next) problems.push(`${where}: needs exactly one of done (an action) or next (an explanation)`);
    if (s.done && typeof s.student !== 'function') problems.push(`${where}: an action step needs a student (how the arena does it)`);
    if (s.action && !s.done) problems.push(`${where}: a step with a button must also be an action (done)`);
    const t = s.target;
    const ok = t === undefined || typeof t === 'string' || typeof t === 'function' || (Array.isArray(t) && t.every((x) => typeof x === 'string')) || (t && typeof t === 'object' && (typeof t.bone === 'string' || typeof t.area === 'string'));
    if (!ok) problems.push(`${where}: unknown target form`);
  });
  return problems;
}
