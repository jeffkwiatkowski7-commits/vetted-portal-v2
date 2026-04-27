export interface User {
  id: string;
  email: string;
  display_name: string;
  job_title?: string;
  department?: string;
  role: 'user' | 'admin' | 'super_admin';
  avatar_path?: string;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
  last_login_at?: string;
}

export interface Chat {
  id: string;
  user_id: string;
  project_id?: string;
  title: string;
  model: string;
  temperature: number;
  system_prompt?: string;
  is_shared: number;
  created_at: string;
  updated_at: string;
  mcp_servers?: string;  // JSON array of mcp_server IDs
  messages?: Message[];
  shared_by?: string;
  permission?: string;
}

export interface SourceCitation {
  filename: string;
  pageNumber: number | null;
}

export interface MessageAttachment {
  id: string;
  filename: string;
  mime_type: string;
  library_visible: boolean;
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant';
  content: string;
  model_used?: string;
  token_count?: number;
  reasoning?: string;
  attachments?: MessageAttachment[] | null;
  images?: Array<{ base64: string; mimeType: string }> | null;
  steps?: string[];
  citations?: SourceCitation[];
  created_at: string;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  default_model: string;
  system_prompt?: string;
  temperature: number;
  tool_sets?: string;
  mcp_servers?: string;  // JSON array of mcp_server IDs
  status: string;
  created_at: string;
  updated_at: string;
  owner_name?: string;
  chat_count?: number;
  file_count?: number;
  member_count?: number;
  permission?: string;
  pptx_template_id?: string | null;
}

export interface ProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  permission: string;
  created_at: string;
  display_name?: string;
  email?: string;
}

export interface LibraryFile {
  id: string;
  user_id: string;
  filename: string;
  original_name: string;
  file_path: string;
  file_type: string;
  file_size: number;
  mime_type: string;
  project_id?: string;
  uploaded_at: string;
  index_status?: 'pending' | 'indexing' | 'ready' | 'error' | null;
}

export interface App {
  id: string;
  name: string;
  description: string;
  icon?: string;
  category: string;
  system_prompt: string;
  model: string;
  temperature: number;
  tool_sets?: string;
  visibility: string;
  status: string;
  route?: string;
  usage_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ToolSet {
  id: string;
  name: string;
  description: string;
  tools: string;
  api_config: string;
  status: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

export interface SystemPrompt {
  id: string;
  name: string;
  prompt_text: string;
  scope: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ModelConfig {
  id: string;
  model_name: string;
  provider: string;
  display_name: string;
  icon_color: string;
  is_default: number;
  is_enabled: number;
  max_tokens: number;
  rate_limit: number;
}

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_preview: string;
  permissions: string;
  expires_at?: string;
  status: string;
  last_used_at?: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  description: string;
  link?: string;
  is_read: number;
  created_at: string;
}

export interface UserPreferences {
  default_model: string;
  default_temperature: number;
  show_reasoning: number;
  auto_scroll: number;
  compact_view: number;
  code_theme: string;
  notify_shared_chat: number;
  notify_project_updates: number;
  notify_system: number;
  notify_weekly_summary: number;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  title: string;
  detail?: string;
  action?: { label: string; onClick: () => void };
}

export interface PipelineStep {
  name: string;
  status: 'pending' | 'active' | 'completed' | 'error';
  elapsed?: number;
  startTime?: number;
}

export interface SearchResult {
  category: 'chats' | 'projects' | 'files' | 'apps';
  id: string;
  title: string;
  subtitle: string;
  timestamp?: string;
}

export interface DemoStep {
  id: number;
  section: string;
  feature: string;
  action: string;
  duration: number;
  target?: string;
  navigate?: string;
}

// ════════════════════════════════════════════════════════════════════
// Skills Types
// ════════════════════════════════════════════════════════════════════

export interface Skill {
  id: string;
  name: string;
  description?: string;
  instructions: string;
  created_at: string;
  updated_at: string;
  file_count?: number;
  files?: LibraryFile[];
}

export interface ProjectSkill {
  skill_id: string;
  skill_name: string;
  skill_description?: string;
  enabled: boolean;
}

// ════════════════════════════════════════════════════════════════════
// Scheduled Tasks (Claude-desktop-style recurring prompts)
// ════════════════════════════════════════════════════════════════════

export type ScheduleType = 'cron' | 'interval' | 'once' | 'manual';

export interface ScheduledTask {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  prompt: string;
  model?: string | null;
  system_prompt?: string | null;
  project_id?: string | null;
  mcp_servers: string[];
  schedule_type: ScheduleType;
  cron_expression?: string | null;
  timezone: string;
  enabled: boolean;
  delivery: { type: 'notification' | 'chat' | 'email'; target?: string };
  cloud_scheduler_job?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  last_status?: 'success' | 'error' | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduledTaskRun {
  id: string;
  task_id: string;
  started_at: string;
  finished_at?: string | null;
  status: 'running' | 'success' | 'error';
  result_text?: string | null;
  error_message?: string | null;
  duration_ms?: number | null;
  trigger?: 'scheduler' | 'manual' | 'tool' | null;
}

// ════════════════════════════════════════════════════════════════════
// Lease Bot Types (from cbre_leases integration)
// ════════════════════════════════════════════════════════════════════

export interface LeaseData {
  id?: string;
  sourceFile: string;
  tenantName: string | null;
  landlordName: string | null;
  propertyAddress: string | null;
  propertyId: string | null;
  projectId: string | null;
  suiteNumber: string | null;
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  monthlyRent: number | null;
  rentEscalationTerms: string | null;
  renewalOptions: string | null;
  permittedUse: string | null;
  squareFootage: number | null;
  securityDeposit: number | null;
  terminationClauses: string | null;
  specialProvisions: string | null;
  fullText?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaseProject {
  id: string;
  name: string;
  persona: string;
  skillIds: string[];
  leaseCount: number;
  totalSquareFootage: number;
  avgMonthlyRent: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaseSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaseProperty {
  id: string;
  name: string;
  address: string;
  leaseCount: number;
  totalSquareFootage: number;
  createdAt?: string;
}

export interface LeaseChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  icon: string;
  command: string;
  args: string;      // JSON array
  env_vars: string;  // JSON object
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface LeaseDashboardStats {
  totalLeases: number;
  totalProperties: number;
  expiring30Days: number;
  expiring90Days: number;
  avgMonthlyRent: number;
  totalSquareFootage: number;
}

// ════════════════════════════════════════════════════════════════════
// PPTX Template Types
// ════════════════════════════════════════════════════════════════════

export type PptxTemplateType = 'ic_memo' | 'one_pager' | 'investor_update' | 'custom';
export type PptxTemplateStatus = 'active' | 'archived';

export interface PptxTemplate {
  id: string;
  name: string;
  template_type: PptxTemplateType;
  slide_count: number;
  has_thumbnail: boolean;
  status: PptxTemplateStatus;
  created_at: string;
  updated_at: string;
}

export interface PptxTemplateDetail extends PptxTemplate {
  manifest: {
    version: number;
    slide_count: number;
    slides: Array<{ index: number; title: string }>;
  } | null;
}
