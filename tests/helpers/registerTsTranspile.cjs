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
  const cacheKey = Buffer.from(`${tsVersion}\0${filename}\0${stats.mtimeMs}`, 'utf8')
    .toString('base64url')
    .slice(0, 180);
  const cachePath = path.join(cacheRoot, `${cacheKey}.js`);
  try {
    return fs.readFileSync(cachePath, 'utf8');
  } catch {
    const outputText = transpileFile(filename);
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(cachePath, outputText, 'utf8');
    return outputText;
  }
}
