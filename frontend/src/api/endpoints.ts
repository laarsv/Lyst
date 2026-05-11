import { api } from './client';
import type {
  AdminUser,
  AuthResponse,
  Collaborator,
  CollaboratorPermission,
  ListItem,
  ListSummary,
  ListType,
  Note,
  PublicListData,
  Reminder,
  ShareInfo,
  Tag,
  User,
} from '@/types';

const unwrap = <T,>(r: { data: { data: T } }): T => r.data.data;

export const AuthApi = {
  login: (email: string, password: string) =>
    api.post<{ data: AuthResponse }>('/auth/login', { email, password }).then(unwrap),
  logout: () => api.post('/auth/logout'),
  refresh: () =>
    api.post<{ data: { access_token: string } }>('/auth/refresh').then(unwrap),
  resetRequest: (email: string) =>
    api.post('/auth/reset-password/request', { email }),
  resetConfirm: (token: string, new_password: string) =>
    api.post('/auth/reset-password/confirm', { token, new_password }),
  acceptInvite: (token: string, name: string, password: string) =>
    api.post('/auth/accept-invite', { token, name, password }),
};

export const MeApi = {
  get: () => api.get<{ data: User }>('/me').then(unwrap),
  update: (payload: {
    name?: string;
    email?: string;
    current_password?: string;
    new_password?: string;
  }) => api.patch<{ data: User }>('/me', payload).then(unwrap),
};

export const AdminApi = {
  listUsers: (q?: string) =>
    api.get<{ data: AdminUser[] }>('/admin/users', { params: q ? { q } : {} }).then(unwrap),
  createUser: (payload: { email: string; name: string; password: string; role: 'admin' | 'user' }) =>
    api
      .post<{ data: { user: User; temp_password: string } }>('/admin/users', payload)
      .then(unwrap),
  inviteUser: (payload: { email: string; name: string; role: 'admin' | 'user' }) =>
    api.post<{ data: User }>('/admin/users/invite', payload).then(unwrap),
  updateUser: (id: number, payload: Partial<{ name: string; email: string; is_active: boolean; role: 'admin' | 'user' }>) =>
    api.patch<{ data: User }>(`/admin/users/${id}`, payload).then(unwrap),
  resetPassword: (id: number) => api.post(`/admin/users/${id}/reset-password`),
  deleteUser: (id: number) => api.delete(`/admin/users/${id}`),
};

export const ListsApi = {
  list: () => api.get<{ data: ListSummary[] }>('/lists').then(unwrap),
  templates: () => api.get<{ data: ListSummary[] }>('/lists/templates').then(unwrap),
  get: (id: number) => api.get<{ data: ListSummary }>(`/lists/${id}`).then(unwrap),
  create: (payload: { title: string; type: ListType; description?: string; color?: string; icon?: string }) =>
    api.post<{ data: ListSummary }>('/lists', payload).then(unwrap),
  update: (id: number, payload: Partial<{ title: string; description: string; color: string; icon: string; type: ListType }>) =>
    api.patch<{ data: ListSummary }>(`/lists/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/lists/${id}`),
  duplicate: (id: number, payload: { title?: string; as_template?: boolean; template_name?: string }) =>
    api.post<{ data: ListSummary }>(`/lists/${id}/duplicate`, payload).then(unwrap),
  reset: (id: number) => api.post(`/lists/${id}/reset`),
};

export const ItemsApi = {
  list: (listId: number) =>
    api.get<{ data: ListItem[] }>(`/lists/${listId}/items`).then(unwrap),
  create: (listId: number, text: string, extras: Partial<{ quantity: number; unit: string }> = {}) =>
    api.post<{ data: ListItem }>(`/lists/${listId}/items`, { text, ...extras }).then(unwrap),
  bulk: (listId: number, lines: string[]) =>
    api.post<{ data: ListItem[] }>(`/lists/${listId}/items/bulk`, { lines }).then(unwrap),
  update: (listId: number, itemId: number, payload: Partial<{ text: string; is_checked: boolean; quantity: number | null; unit: string | null }>) =>
    api.patch<{ data: ListItem }>(`/lists/${listId}/items/${itemId}`, payload).then(unwrap),
  remove: (listId: number, itemId: number) =>
    api.delete(`/lists/${listId}/items/${itemId}`),
  reorder: (listId: number, items: { id: number; position: number }[]) =>
    api.patch(`/lists/${listId}/items/reorder`, { items }),
};

export const ShareApi = {
  enable: (listId: number) =>
    api.post<{ data: ShareInfo }>(`/lists/${listId}/share/enable`).then(unwrap),
  disable: (listId: number) => api.post(`/lists/${listId}/share/disable`),
  getPublic: (token: string) =>
    api.get<{ data: PublicListData }>(`/share/${token}`).then(unwrap),
  collaborators: (listId: number) =>
    api.get<{ data: Collaborator[] }>(`/lists/${listId}/collaborators`).then(unwrap),
  addCollaborator: (listId: number, email: string, permission: CollaboratorPermission) =>
    api
      .post<{ data: Collaborator }>(`/lists/${listId}/collaborators`, { email, permission })
      .then(unwrap),
  removeCollaborator: (listId: number, userId: number) =>
    api.delete(`/lists/${listId}/collaborators/${userId}`),
};

export const RemindersApi = {
  list: (listId: number) =>
    api.get<{ data: Reminder[] }>(`/lists/${listId}/reminders`).then(unwrap),
  create: (listId: number, remind_at: string, message?: string) =>
    api
      .post<{ data: Reminder }>(`/lists/${listId}/reminders`, { remind_at, message })
      .then(unwrap),
  remove: (listId: number, reminderId: number) =>
    api.delete(`/lists/${listId}/reminders/${reminderId}`),
};

export const NotesApi = {
  list: (params?: { q?: string; tag?: string }) =>
    api.get<{ data: Note[] }>('/notes', { params }).then(unwrap),
  get: (id: number) => api.get<{ data: Note }>(`/notes/${id}`).then(unwrap),
  create: (payload: { title: string; content?: string; tags?: string[] }) =>
    api.post<{ data: Note }>('/notes', payload).then(unwrap),
  update: (id: number, payload: Partial<{ title: string; content: string; tags: string[] }>) =>
    api.patch<{ data: Note }>(`/notes/${id}`, payload).then(unwrap),
  remove: (id: number) => api.delete(`/notes/${id}`),
};

export const TagsApi = {
  list: () => api.get<{ data: Tag[] }>('/tags').then(unwrap),
  create: (name: string, color?: string) =>
    api.post<{ data: Tag }>('/tags', { name, color }).then(unwrap),
  remove: (id: number) => api.delete(`/tags/${id}`),
};
