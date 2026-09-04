import axios from 'axios';
import type {
  Task, FollowUp, Project, Person, Department, Vendor, SystemRecord, Issue, Meeting,
  Category, Tool, CalendarConnection,
} from '../types';

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

export const taskApi = crud<Task>('/tasks');
export const followupApi = crud<FollowUp>('/followups');
export const projectApi = crud<Project>('/projects');
export const peopleApi = crud<Person>('/people');
export const departmentApi = crud<Department>('/departments');
export const vendorApi = crud<Vendor>('/vendors');
export const systemApi = crud<SystemRecord>('/systems');
export const issueApi = crud<Issue>('/issues');
export const meetingApi = crud<Meeting>('/meetings');
export const categoryApi = crud<Category>('/categories');
export const toolApi = crud<Tool>('/tools');

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

export const calendarApi = {
  ...crud<CalendarConnection>('/calendar/connections'),
  test: (id: number) => client.post(`/calendar/connections/${id}/test`),
  sync: (id: number) => client.post(`/calendar/connections/${id}/sync`),
  syncAll: () => client.post('/calendar/sync'),
  beginSignIn: (id: number) => client.post(`/calendar/connections/${id}/connect/device`),
  pollSignIn: (id: number, device_code: string) =>
    client.post(`/calendar/connections/${id}/connect/poll`, { device_code }),
  signOut: (id: number) => client.post(`/calendar/connections/${id}/disconnect`),
};

/** Let a hand-edited field start tracking the calendar again. */
export const meetingSync = {
  unlock: (id: number, field: string) =>
    client.post(`/meetings/${id}/unlock`, null, { params: { field } }),
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
