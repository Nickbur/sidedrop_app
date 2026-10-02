// ESLint flat config — Vue 3 + TypeScript (type-aware). Formatting is Prettier's job:
// eslint-config-prettier switches off every stylistic rule.
import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig(
    globalIgnores(['**/dist/', '**/dev-dist/', '**/coverage/', 'android/', 'ios/', 'public/', 'src-tauri/']),
    js.configs.recommended,
    tseslint.configs.recommended,
    vue.configs['flat/recommended'],
    {
        files: ['**/*.vue'],
        languageOptions: { parserOptions: { parser: tseslint.parser } },
        // TypeScript (vue-tsc) already reports undefined names; core no-undef misreads type-only globals.
        rules: { 'no-undef': 'off' },
    },
    {
        files: ['**/*.{ts,mts,cts,vue}'],
        languageOptions: {
            parserOptions: {
                // No tsconfig.node.json here: the root vite config gets the default project.
                projectService: { allowDefaultProject: ['vite.config.ts'] },
                tsconfigRootDir: import.meta.dirname,
                extraFileExtensions: ['.vue'],
            },
        },
        rules: {
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
        },
    },
    {
        rules: {
            // A leading underscore marks an intentionally unused binding (`_req`, `_unused`).
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_',
                },
            ],
        },
    },
    {
        languageOptions: { globals: globals.browser },
        rules: {
            // Ionic web components take named slots through the native `slot` attribute.
            'vue/no-deprecated-slot-attribute': 'off',
            // Routed pages (Login, Settings, …) are never used as tags, so single words are safe.
            'vue/multi-word-component-names': 'off',
        },
    },
    {
        files: ['*.{js,mjs,cjs,ts,mts}', 'scripts/**', 'tools/**'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    prettier,
);
