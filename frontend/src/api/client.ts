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
