import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_PROMPT } from './prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || 'claude-sonnet-5-5';
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 5); // revisiones por IP al día
const ACCESS_CODE = process.env.ACCESS_CODE || ''; // código que comparten con los estudiantes
const MAX_BODY = 40 * 1024 * 1024; // bytes (base64 infla ~33 %)
const ALLOWED_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

const usage = new Map(); // ip -> { day, count }

if (!API_KEY) {
  console.error('Falta la variable de entorno ANTHROPIC_API_KEY.');
  process.exit(1);
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0] : req.socket.remoteAddress || 'unknown').trim();
}

function withinLimit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  const entry = usage.get(ip);
  if (!entry || entry.day !== today) {
    usage.set(ip, { day: today, count: 1 });
    return true;
  }
  if (entry.count >= DAILY_LIMIT) return false;
  entry.count += 1;
  return true;
}

function validDoc(doc) {
  return (
    doc &&
    typeof doc.name === 'string' &&
    ALLOWED_TYPES.has(doc.type) &&
    typeof doc.data === 'string' &&
    doc.data.length > 0
  );
}

function docToContent(doc, label) {
  const source = { type: 'base64', media_type: doc.type, data: doc.data };
  const block =
    doc.type === 'application/pdf'
      ? { type: 'document', source, title: doc.name }
      : { type: 'image', source };
  return [{ type: 'text', text: label }, block];
}

async function review(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    if (err.code === 'too_large') {
      return send(res, 413, { error: 'Los archivos son demasiados grandes (máximo 40 MB en total).' });
    }
    return send(res, 400, { error: 'Solicitud inválida.' });
  }

  if (ACCESS_CODE && body.code !== ACCESS_CODE) {
    return send(res, 401, { error: 'Código de acceso incorrecto.' });
  }

  const ip = clientIp(req);
  if (!withinLimit(ip)) {
    return send(res, 429, {
      error: `Llegaste al límite de ${DAILY_LIMIT} revisiones por hoy. Vuelve mañana.`,
    });
  }

  const { poster, article, notes } = body;
  if (!validDoc(poster)) {
    return send(res, 400, { error: 'Sube tu póster en formato PDF, PNG o JPG.' });
  }
  if (article && !validDoc(article)) {
    return send(res, 400, { error: 'El artículo debe ser un PDF, PNG o JPG.' });
  }

  const content = [];
  content.push(...docToContent(poster, 'PÓSTER del estudiante (a revisar):'));
  if (article) {
    content.push(...docToContent(article, 'ARTÍCULO base (fuente para verificar C3b, C4d, C8a y C8c):'));
  } else {
    content.push({
      type: 'text',
      text: 'No se adjuntó el artículo base. Marca como "no verificable" lo que dependa de la fuente.',
    });
  }
  if (typeof notes === 'string' && notes.trim()) {
    content.push({ type: 'text', text: `Comentario del estudiante: ${notes.trim().slice(0, 500)}` });
  }

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });

    const data = await apiRes.json();
    if (!apiRes.ok) {
      console.error('Error de la API:', apiRes.status, data?.error?.message);
      return send(res, 502, { error: 'No se pudo generar la revisión. Intenta de nuevo en unos minutos.' });
    }

    const text = (data.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return send(res, 200, { review: text });
  } catch (err) {
    console.error('Error de red:', err);
    return send(res, 502, { error: 'No se pudo conectar con el servicio. Intenta más tarde.' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/review') {
      return await review(req, res);
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      const html = await readFile(join(__dirname, 'public', 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Error interno.' });
  }
});

server.listen(PORT, () => {
  console.log(`Revisor de pósters en http://localhost:${PORT}`);
});
