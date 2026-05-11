export type Role = 'admin' | 'user';
export type ListType = 'SHOPPING' | 'PACKING' | 'CHECKLIST' | 'CUSTOM';
export type CollaboratorPermission = 'VIEW' | 'EDIT';

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  is_active: boolean;
  email_verified: boolean;
  last_login: string | null;
  created_at: string;
}

export interface AdminUser extends User {
  list_count: number;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  role: Role;
  user_id: number;
  name: string;
  email: string;
}

export interface ListSummary {
  id: number;
  title: string;
  type: ListType;
  description: string | null;
  color: string | null;
  icon: string | null;
  owner_id: number;
  is_template: boolean;
  template_name: string | null;
  share_enabled: boolean;
  share_token: string | null;
  created_at: string;
  updated_at: string;
  item_count: number;
  checked_count: number;
  is_owner: boolean;
  permission: CollaboratorPermission | null;
}

export interface ListItem {
  id: number;
  list_id: number;
  text: string;
  is_checked: boolean;
  quantity: number | null;
  unit: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Collaborator {
  user_id: number;
  email: string;
  name: string;
  permission: CollaboratorPermission;
}

export interface Reminder {
  id: number;
  list_id: number;
  user_id: number;
  remind_at: string;
  message: string | null;
  sent: boolean;
  created_at: string;
}

export interface Note {
  id: number;
  owner_id: number;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: number;
  owner_id: number;
  name: string;
  color: string | null;
  created_at: string;
}

export interface ShareInfo {
  share_token: string;
  share_url: string;
  qr_code_png_base64: string;
}

export interface PublicListData {
  title: string;
  type: ListType;
  description: string | null;
  color: string | null;
  icon: string | null;
  updated_at: string;
  items: Array<{
    id: number;
    text: string;
    is_checked: boolean;
    quantity: number | null;
    unit: string | null;
    position: number;
  }>;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: string | null;
}
