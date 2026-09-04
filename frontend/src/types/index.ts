export type TaskStatus =
  | 'INBOX' | 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED' | 'CANCELLED';
export type Priority = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
export type FollowUpStatus =
  | 'WAITING' | 'FOLLOW_UP_DUE' | 'OVERDUE' | 'RECEIVED' | 'CANCELLED';
export type WaitingForType = 'PERSON' | 'DEPARTMENT' | 'VENDOR';
export type ProjectStatus =
  | 'PLANNED' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type IssueStatus =
  | 'OPEN' | 'INVESTIGATING' | 'MITIGATING' | 'BLOCKED' | 'RESOLVED' | 'CLOSED';

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date?: string | null;
  category_id?: number | null;
  project_id?: number | null;
  system_id?: number | null;
  department_id?: number | null;
  responsible_person_id?: number | null;
  vendor_id?: number | null;
  next_action?: string | null;
  blocked_reason?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface FollowUp {
  id: number;
  title: string;
  description?: string | null;
  status: FollowUpStatus;
  waiting_for_type: WaitingForType;
  person_id?: number | null;
  department_id?: number | null;
  vendor_id?: number | null;
  task_id?: number | null;
  requested_date?: string | null;
  expected_date?: string | null;
  follow_up_date?: string | null;
  last_contact_date?: string | null;
  next_action?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Project {
  id: number;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  priority: Priority;
  start_date?: string | null;
  target_date?: string | null;
  owner?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Person {
  id: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  department_id?: number | null;
  vendor_id?: number | null;
  notes?: string | null;
  active: boolean;
}

export interface Department {
  id: number;
  name: string;
  description?: string | null;
  contact_person_id?: number | null;
  notes?: string | null;
  active: boolean;
}

export interface Vendor {
  id: number;
  name: string;
  type?: string | null;
  primary_contact_id?: number | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface SystemRecord {
  id: number;
  name: string;
  description?: string | null;
  environment?: string | null;
  owner?: string | null;
  notes?: string | null;
  active: boolean;
}

export interface Issue {
  id: number;
  title: string;
  description?: string | null;
  severity: IssueSeverity;
  status: IssueStatus;
  system_id?: number | null;
  project_id?: number | null;
  responsible_person_id?: number | null;
  vendor_id?: number | null;
  department_id?: number | null;
  detected_at?: string | null;
  resolved_at?: string | null;
  root_cause?: string | null;
  resolution?: string | null;
  notes?: string | null;
}

export interface Meeting {
  id: number;
  title: string;
  meeting_date?: string | null;
  participants?: string | null;
  notes?: string | null;
  decisions?: string | null;
  primary_contact_id?: number | null;

  // Calendar detail. `source` is "WCC" for a meeting created here, otherwise
  // the provider it was synced from - which decides whether it can be deleted.
  source?: string | null;
  external_id?: string | null;
  connection_id?: number | null;
  ends_at?: string | null;
  organizer?: string | null;
  location?: string | null;
  is_online?: boolean | null;
  join_url?: string | null;
  is_cancelled?: boolean | null;
  last_synced_at?: string | null;
  /** Fields you have edited by hand; sync leaves these alone. */
  locally_edited?: string[] | null;
}

export interface CalendarConnection {
  id: number;
  provider: 'microsoft' | 'ics';
  display_name: string;
  tenant_id?: string | null;
  client_id?: string | null;
  account?: string | null;
  ics_url?: string | null;
  days_back?: number | null;
  days_ahead?: number | null;
  enabled?: boolean | null;
  status?: 'not_connected' | 'connected' | 'error' | null;
  last_error?: string | null;
  last_sync_at?: string | null;
  last_sync_summary?: string | null;
}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
  message?: string | null;
}

export interface SyncSummary {
  created: number;
  updated: number;
  unchanged: number;
  protected: number;
  cancelled: number;
}

export interface Category {
  id: number;
  name: string;
  description?: string | null;
}

export interface DashboardStats {
  critical: number;
  followups_due: number;
  overdue: number;
  today: number;
  in_progress: number;
  blocked: number;
  forgotten: number;
  total_tasks: number;
  completed_today: number;
}

export interface Alert {
  id: string;
  type: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  entity_id: number;
  entity_type: string;
  created_at?: string;
}

export interface SearchResult {
  id: number;
  type: string;
  title: string;
  description?: string | null;
  status?: string | null;
}

export interface Attachment {
  id: number;
  entity_type: string;
  entity_id: number;
  filename: string;
  /** Position within an uploaded folder, e.g. "css/style.css". */
  path: string;
  content_type: string;
  size: number;
  created_at?: string;
}

export interface Tool {
  id: number;
  name: string;
  description?: string | null;
  entry_path?: string | null;
  pinned: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ToolManifest {
  id: number;
  name: string;
  entry_path: string | null;
  runnable: boolean;
  file_count: number;
  total_bytes: number;
  files: { id: number; path: string; content_type: string; size: number }[];
}
