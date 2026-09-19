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
  all_day?: boolean | null;
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
  /** IANA zone whose wall clock these meetings read in. */
  timezone?: string | null;
  days_back?: number | null;
  days_ahead?: number | null;
  enabled?: boolean | null;
  /** Whether the server syncs this calendar on a schedule of its own. */
  auto_sync?: boolean | null;
  sync_interval_minutes?: number | null;
  consecutive_failures?: number | null;
  next_sync_at?: string | null;
  /** Seconds until the next automatic sync; negative means it is due now. */
  next_sync_in_seconds?: number | null;
  /** False when automatic syncing is switched off for the whole deployment. */
  auto_sync_available?: boolean | null;
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


export interface KnowledgeArticle {
  id: number;
  title: string;
  kind: 'NOTE' | 'RUNBOOK' | 'GUIDE' | 'REFERENCE';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  summary?: string | null;
  body?: string | null;
  tags?: string | null;
  system_id?: number | null;
  project_id?: number | null;
  department_id?: number | null;
  vendor_id?: number | null;
  category_id?: number | null;
  server_id?: number | null;
  environment?: string | null;
  last_verified_at?: string | null;
  pinned?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export interface Server {
  id: number;
  name: string;
  hostname?: string | null;
  /** The record it resolves by, e.g. mbsapp01.bank.local. */
  dns_name?: string | null;
  ip_address?: string | null;
  environment: string;
  os?: string | null;
  role?: string | null;
  system_id?: number | null;
  department_id?: number | null;
  vendor_id?: number | null;
  owner_person_id?: number | null;
  paired_server_id?: number | null;
  /** Null means the usual 22 / 3389, and connect links leave the port out. */
  ssh_port?: number | null;
  rdp_port?: number | null;
  notes?: string | null;
  active?: boolean | null;
}

export interface ServerAccount {
  id: number;
  server_id: number;
  username: string;
  account_type: string;
  purpose?: string | null;
  /** Where the authoritative credential lives, e.g. a vault safe. */
  vault_location?: string | null;
  last_rotated_at?: string | null;
  rotation_days?: number | null;
  notes?: string | null;
  active?: boolean | null;
  /** Whether a password is stored here at all. The password itself is never sent. */
  has_secret?: boolean | null;
  /** Whether revealing it would work right now, given the server's vault key. */
  secret_readable?: boolean | null;
}

export interface SecretAccessEntry {
  id: number;
  action: 'SET' | 'REVEAL' | 'CLEAR' | 'DENIED';
  at: string;
  detail?: string | null;
}

export type ConnectMethod = 'rdp' | 'sftp' | 'ssh';

/** Everything needed to open one account in a desktop client.
 *  `secret` is present only when a password is stored and the vault is open;
 *  it is deliberately absent from `launch`, which may be written to disk. */
export interface ConnectPlan {
  method: ConnectMethod;
  label: string;
  host: string;
  /** Which field the address came from: "IP address", "DNS name", "hostname". */
  host_field: string;
  port: number;
  port_is_default: boolean;
  username: string;
  secret?: string | null;
  secret_error?: string | null;
  command: string;
  launch:
    | { kind: 'uri'; value: string }
    | { kind: 'file'; filename: string; content: string; mime: string };
}

/** What a Word import did. `article.body` is the authoritative new body. */
export interface DocxImportResult {
  article: KnowledgeArticle;
  created: boolean;
  images: number;
  /** Figures kept as attachments but not shown inline - Word's EMF/WMF vectors. */
  images_skipped: number;
  warnings: string[];
}

/* ------------------------------------------------------------------- chat */

export interface ChatStatus {
  enabled: boolean;
  base_url: string;
  model: string | null;
  api_key_set: boolean;
  detail: string;
  tools: string[];
  secrets_included: boolean;
}

export interface ChatThread {
  id: number;
  title: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** One stored turn. A `tool` message is the result of the call above it. */
export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  created_at?: string | null;
  tool_name?: string | null;
  tool_calls?: {
    id: string;
    function: { name: string; arguments: string };
  }[] | null;
}

export interface ChatTurn {
  thread: { id: number; title: string };
  messages: ChatMessage[];
}

export interface VaultStatus {
  configured: boolean;
  env_var: string;
  detail: string;
}

/** Importing a tool from a repository link. */
export interface ImportStatus {
  enabled: boolean;
  hosts: string[];
  token_set: boolean;
  detail: string;
  max_files: number;
  max_bytes: number;
}

export interface ImportResult {
  tool: { id: number; name: string; description?: string | null; entry_path?: string | null };
  imported: number;
  bytes: number;
  entry_path: string | null;
  runnable: boolean;
  ref: string | null;
  source_url: string;
  /** Why files were left behind, and how many of each. */
  skipped: Record<string, number>;
  files: string[];
}
