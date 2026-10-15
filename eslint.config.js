// Flat config. Exactly the two rule families architecture §1.1 names, scoped to src/core/**.
// No style rules: formatting is not a portability contract, and the two rules below are.
import tseslint from 'typescript-eslint';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      // §1.1: src/core may not import anything under src/ui, nor anything DOM-ish.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/ui/**', '**/ui', 'jsdom', 'happy-dom'],
          message: 'src/core is DOM-free and framework-free (architecture §1.1).',
        }],
      }],
      // §1.1 + determinism rules 5 and 13: no transcendental, no RNG, no clock.
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'pow',    message: 'no transcendental in src/core (rule 5) — use the PWL table.' },
        { object: 'Math', property: 'exp',    message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'expm1',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'log',    message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'log2',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'log10',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'log1p',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'sqrt',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'cbrt',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'sin',    message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'cos',    message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'tan',    message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'asin',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'acos',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'atan',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'atan2',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'sinh',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'cosh',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'tanh',   message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'asinh',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'acosh',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'atanh',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'hypot',  message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'fround', message: 'no transcendental in src/core (rule 5).' },
        { object: 'Math', property: 'random', message: 'no RNG in src/core (rule 13).' },
        { object: 'Date', property: 'now',    message: 'no wall clock in src/core (rule 13).' },
        { object: 'Date', property: 'parse',  message: 'no wall clock in src/core (rule 13).' },
        { object: 'performance', property: 'now', message: 'no wall clock in src/core (rule 13).' },
      ],
      // `no-restricted-properties` only sees member names: `**` is `Math.pow` spelled as an
      // operator, and `new Date()` is the clock spelled as a constructor. Both are barred too.
      // The one exemption is a literal base of 2: `2 ** k` for integer k is an exact binary64
      // power, which is how rotary.ts reassembles its 64-bit quotient.
      'no-restricted-syntax': ['error',
        {
          selector: "BinaryExpression[operator='**']:not([left.value=2])",
          message: 'no transcendental in src/core (rule 5) — ** is Math.pow; only 2 ** k is exact.',
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message: 'no transcendental in src/core (rule 5) — **= is Math.pow, use the PWL table.',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'no wall clock in src/core (rule 13).',
        },
      ],
    },
  },
];
