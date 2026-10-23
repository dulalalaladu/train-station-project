// Runs on staged files only (husky pre-commit). Keep it fast; CI runs the full suite.
export default {
  '*.{ts,tsx,js,mjs,cjs}': ['eslint --fix --no-warn-ignored', 'prettier --write'],
  '*.{json,yml,yaml}': 'prettier --write',
  '*.py': [
    'uv run --no-sync ruff check --fix --config pyproject.toml',
    'uv run --no-sync black --config pyproject.toml',
  ],
};
