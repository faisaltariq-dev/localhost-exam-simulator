// Thin fetch wrappers around the local JSON API. Errors throw ApiError with the server's message(s).

export class ApiError extends Error {
  constructor(status, data) {
    const errors = (data && data.errors) || (data && data.error ? [data.error] : [`Request failed (${status})`]);
    super(errors.join('\n'));
    this.status = status;
    this.errors = errors;
  }
}

async function request(method, url, body, raw = false) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) {
      opts.body = body;
      opts.headers['Content-Type'] = 'text/markdown; charset=utf-8';
    } else {
      opts.body = JSON.stringify(body);
      opts.headers['Content-Type'] = 'application/json';
    }
  }
  const res = await fetch(url, opts);
  if (res.status === 204) return null;
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

const enc = encodeURIComponent;

export const api = {
  listExams: () => request('GET', '/api/exams'),
  getExam: (id) => request('GET', `/api/exams/${enc(id)}`),
  deleteExam: (id) => request('DELETE', `/api/exams/${enc(id)}`),
  getAttempts: (id) => request('GET', `/api/exams/${enc(id)}/attempts`),
  postAttempt: (id, attempt) => request('POST', `/api/exams/${enc(id)}/attempts`, attempt),
  setRevised: (id, n, revised) => request('PATCH', `/api/exams/${enc(id)}/attempts/${n}`, { revised }),
  getSettings: () => request('GET', '/api/settings'),
  putSettings: (settings) => request('PUT', '/api/settings', settings),
  getPrompt: () => request('GET', '/prompt-for-exam.md'),
  async upload(file) {
    const text = await file.text();
    return request('POST', `/api/upload?filename=${enc(file.name)}`, text, true);
  },
  uploadText: (text) => request('POST', '/api/upload', text, true),
  inboxStatus: () => request('GET', '/api/inbox'),
  sendToInbox: (text) => request('POST', '/api/inbox', text, true),
};
