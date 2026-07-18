import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts', 'src/data/**/*.ts'],
    rules: {
      // The sim layer must stay headless-testable and portable.
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'phaser', message: 'src/sim must not depend on Phaser.' }] },
      ],
    },
  },
  { ignores: ['dist/'] },
);
