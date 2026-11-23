/**
 * Jest runs in ESM mode: NestJS 12 packages are ESM-only, so CJS ts-jest
 * transforms cannot require them on Node 22. The test script sets
 * NODE_OPTIONS=--experimental-vm-modules (required by Jest's ESM runtime).
 *
 * @type {import('jest').Config}
 */
export default {
  testEnvironment: 'node',
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  // Source files import siblings without extensions; Jest's resolver handles
  // this for transformed files, but must not rewrite bare specifiers.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        useESM: true,
      },
    ],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/generated/**', '!src/main.ts'],
};
