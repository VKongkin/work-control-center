import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

/** Turn an axios failure into a message worth showing a human. */
export function apiError(err: any): string {
  const d = err?.response?.data;
  if (typeof d?.detail === 'string') return d.detail;
  if (Array.isArray(d?.detail)) {
    return d.detail
      .map((e: any) => `${(e.loc || []).slice(1).join('.') || 'field'}: ${e.msg}`)
      .join(', ');
  }
  if (err?.message) return err.message;
  return 'Something went wrong';
}

function crud<T>(path: string) {
  return {
    getAll: (params?: any) => client.get<T[]>(path, { params }),
    getById: (id: number) => client.get<T>(`${path}/${id}`),
    create: (data: Partial<T>) => client.post<T>(path, data),
    update: (id: number, data: Partial<T>) => client.put<T>(`${path}/${id}`, data),
    delete: (id: number) => client.delete(`${path}/${id}`),
  };
}

export const taskApi = crud('/tasks');
export const followupApi = crud('/followups');
export const projectApi = crud('/projects');
export const peopleApi = crud('/people');
export const departmentApi = crud('/departments');
export const vendorApi = crud('/vendors');
export const systemApi = crud('/systems');
export const issueApi = crud('/issues');
export const meetingApi = crud('/meetings');
export const categoryApi = crud('/categories');
export const toolApi = crud('/tools');

export const attachmentApi = {
  list: (entity_type: string, entity_id: number) =>
    client.get('/attachments', { params: { entity_type, entity_id } }),

  /**
   * Relative paths travel as a JSON array rather than repeated form fields:
   * multipart list parsing differs between clients and can silently reorder,
   * which would scramble a folder's structure.
   */
  upload: (entity_type: string, entity_id: number, files: File[], paths?: string[]) => {
    const body = new FormData();
    body.append('entity_type', entity_type);
    body.append('entity_id', String(entity_id));
    files.forEach((f) => body.append('files', f));
    if (paths?.length) body.append('paths', JSON.stringify(paths));
    return client.post('/attachments', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },

  remove: (id: number) => client.delete(`/attachments/${id}`),
  downloadUrl: (id: number) => `/api/attachments/${id}/download`,
  inlineUrl: (id: number) => `/api/attachments/${id}/inline`,
};

export const toolFiles = {
  manifest: (id: number) => client.get(`/tools/${id}/manifest`),
  entryUrl: (id: number, entry: string) => `/api/tools/${id}/serve/${entry}`,
};

export const dashboardApi = {
  getStats: () => client.get('/dashboard'),
};

export const alertsApi = {
  getAll: () => client.get('/alerts'),
};

export const searchApi = {
  search: (q: string) => client.get('/search', { params: { q } }),
};

export default client;
