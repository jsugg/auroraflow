import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 4173;
const HOST = '127.0.0.1';
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'tests',
  'fixtures',
  'e2e-app',
);
const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function resolveRequestedPath(requestUrl) {
  const parsedUrl = new URL(requestUrl ?? '/', `http://${HOST}`);
  const rawPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const decodedPath = decodeURIComponent(rawPath);
  const candidatePath = path.resolve(ROOT, `.${decodedPath}`);

  if (!candidatePath.startsWith(`${ROOT}${path.sep}`) && candidatePath !== ROOT) {
    return null;
  }

  return candidatePath;
}

function respond(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    respond(response, 405, 'Method Not Allowed', { allow: 'GET, HEAD' });
    return;
  }

  const filePath = resolveRequestedPath(request.url);
  if (filePath === null) {
    respond(response, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      respond(response, 404, 'Not Found');
      return;
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': fileStat.size,
      'content-type': MIME_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream',
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    respond(response, 404, 'Not Found');
  }
});

const port = Number.parseInt(process.env.AURORAFLOW_E2E_FIXTURE_PORT ?? '', 10) || DEFAULT_PORT;
server.listen(port, HOST, () => {
  console.log(`AuroraFlow e2e fixture app listening at http://${HOST}:${port}`);
});
