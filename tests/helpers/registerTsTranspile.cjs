const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Resolve the compiler version from its manifest (a cheap JSON read) so warm cache
// lookups don't pay the ~1s cost of `require('typescript')`. The compiler itself is
// loaded lazily and only on a cache miss, i.e. when a file actually needs transpiling.
const tsVersion = require('typescript/package.json').version;
let tsModule = null;
function loadTypeScript() {
  return (tsModule ??= require('typescript'));
}

require.extensions['.ts'] = (module, filename) => {
  const outputText = readCachedOutput(filename) ?? transpileFile(filename);
  module._compile(outputText, filename);
};

function transpileFile(filename) {
  const ts = loadTypeScript();
  const source = fs.readFileSync(filename, 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      sourceMap: false,
    },
    fileName: filename,
  }).outputText;
}

function readCachedOutput(filename) {
  const cacheRoot = process.env.AURORAFLOW_TS_TRANSPILE_CACHE;
  if (!cacheRoot) {
    return null;
  }

  const stats = fs.statSync(filename);
  // Hash the identity so the key is fixed-length and collision-resistant. The old
  // base64url(...).slice(0, 180) truncated long absolute paths before the filename,
  // so sibling modules under a deep checkout path (e.g. a long CI/worktree prefix)
  // collided to one cache entry and a module was served another file's transpile.
  const cacheKey = crypto
    .createHash('sha256')
    .update(`${tsVersion}\0${filename}\0${stats.mtimeMs}`)
    .digest('base64url');
  const cachePath = path.join(cacheRoot, `${cacheKey}.js`);
  try {
    return fs.readFileSync(cachePath, 'utf8');
  } catch {
    const outputText = transpileFile(filename);
    fs.mkdirSync(cacheRoot, { recursive: true });
    // Publish atomically: two script children can cold-transpile the same uncached
    // module concurrently, and a plain writeFileSync lets one read the other's
    // half-written entry -- a truncated module drops its trailing exports and fails
    // with "X is not a function". Write a unique temp file, then rename (atomic on
    // the same filesystem) so a reader only ever sees a complete entry or none.
    const tempPath = path.join(
      cacheRoot,
      `${cacheKey}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      fs.writeFileSync(tempPath, outputText, 'utf8');
      fs.renameSync(tempPath, cachePath);
    } catch {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Best-effort cleanup; the current process still returns its own output.
      }
    }
    return outputText;
  }
}
