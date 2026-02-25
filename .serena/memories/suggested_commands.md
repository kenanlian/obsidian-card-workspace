# Development Commands

## Build
```bash
npm run build          # Production build (esbuild, outputs main.js)
npm run dev            # Watch mode (esbuild --watch)
npm run check          # TypeScript type-checking only (tsc --noEmit)
```

## Install
```bash
npm install
```

## Notes
- No linter (ESLint) is configured
- No test framework is configured
- No formatter (Prettier) is configured
- The output is `main.js` (CJS format) in the project root
- `styles.css` is loaded by Obsidian automatically

## System (Windows)
- Use `dir` or PowerShell `ls` instead of Unix `ls`
- Use `type` or PowerShell `Get-Content` instead of `cat`
- Git is available
