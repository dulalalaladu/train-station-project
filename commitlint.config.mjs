// Conventional commits restricted to the types allowed by plan §9 / git-workflow.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'refactor', 'docs', 'test', 'chore', 'perf', 'ci']],
    // Subjects are frequently Chinese; case rules do not apply.
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
