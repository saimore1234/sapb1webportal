import { apiClient } from './client';
import type {
  ApiResponse,
  AdminUser,
  CreateUserPayload,
  UpdateUserPayload,
  AdminRole,
  CreateRolePayload,
  Permission,
  PagePermission,
  RolePermissions,
  ServerConfiguration,
  CreateServerConfigurationPayload,
  UpdateServerConfigurationPayload,
  TestConnectionPayload,
  TestConnectionResult,
  TestAllResult
} from '../types';

async function unwrap<T>(promise: Promise<{ data: ApiResponse<T> }>, failMessage: string): Promise<T> {
  const { data } = await promise;
  if (!data.success || data.data === null || data.data === undefined) {
    throw new Error(data.message || failMessage);
  }
  return data.data;
}

// Users
export const getUsers = () => unwrap<AdminUser[]>(apiClient.get('/admin/users'), 'Failed to load users.');
export const createUser = (payload: CreateUserPayload) => unwrap<{ id: number }>(apiClient.post('/admin/users', payload), 'Failed to create user.');
export const updateUser = (id: number, payload: UpdateUserPayload) => apiClient.put(`/admin/users/${id}`, payload);
export const resetUserPassword = (id: number, newPassword: string) => apiClient.post(`/admin/users/${id}/reset-password`, { newPassword });
export const deleteUser = (id: number) => apiClient.delete(`/admin/users/${id}`);

// Roles
export const getRoles = () => unwrap<AdminRole[]>(apiClient.get('/admin/roles'), 'Failed to load roles.');
export const createRole = (payload: CreateRolePayload) => unwrap<{ id: number }>(apiClient.post('/admin/roles', payload), 'Failed to create role.');
export const updateRole = (id: number, payload: CreateRolePayload) => apiClient.put(`/admin/roles/${id}`, payload);
export const getRolePermissions = (id: number) => unwrap<RolePermissions>(apiClient.get(`/admin/roles/${id}/permissions`), 'Failed to load role permissions.');
export const updateRolePermissions = (id: number, permissionKeys: string[], pagePermissions: PagePermission[]) =>
  apiClient.put(`/admin/roles/${id}/permissions`, { permissionKeys, pagePermissions });

// Permissions
export const getPermissions = () => unwrap<Permission[]>(apiClient.get('/admin/permissions'), 'Failed to load permissions.');

// Server / Company Configuration
export const getServerConfigurations = () =>
  unwrap<ServerConfiguration[]>(apiClient.get('/admin/server-configurations'), 'Failed to load server configurations.');
export const getServerConfiguration = (id: number) =>
  unwrap<ServerConfiguration>(apiClient.get(`/admin/server-configurations/${id}`), 'Failed to load server configuration.');
export const createServerConfiguration = (payload: CreateServerConfigurationPayload) =>
  unwrap<{ id: number }>(apiClient.post('/admin/server-configurations', payload), 'Failed to create server configuration.');
export const updateServerConfiguration = (id: number, payload: UpdateServerConfigurationPayload) =>
  apiClient.put(`/admin/server-configurations/${id}`, payload);
export const enableServerConfiguration = (id: number) => apiClient.post(`/admin/server-configurations/${id}/enable`);
export const disableServerConfiguration = (id: number) => apiClient.post(`/admin/server-configurations/${id}/disable`);
export const deleteServerConfiguration = (id: number) => apiClient.delete(`/admin/server-configurations/${id}`);
export const testServerConfigurationForm = (payload: TestConnectionPayload) =>
  unwrap<TestAllResult>(apiClient.post('/admin/server-configurations/test', payload), 'Connection test failed.');
export const testServerConfigurationFormSql = (payload: TestConnectionPayload) =>
  unwrap<TestConnectionResult>(apiClient.post('/admin/server-configurations/test-sql', payload), 'SQL connection test failed.');
export const testServerConfigurationFormSap = (payload: TestConnectionPayload) =>
  unwrap<TestConnectionResult>(apiClient.post('/admin/server-configurations/test-sap', payload), 'SAP connection test failed.');
export const testServerConfigurationSql = (id: number) =>
  unwrap<TestConnectionResult>(apiClient.post(`/admin/server-configurations/${id}/test-sql`), 'SQL connection test failed.');
export const testServerConfigurationSap = (id: number) =>
  unwrap<TestConnectionResult>(apiClient.post(`/admin/server-configurations/${id}/test-sap`), 'SAP connection test failed.');
export const testServerConfigurationAll = (id: number) =>
  unwrap<TestAllResult>(apiClient.post(`/admin/server-configurations/${id}/test-all`), 'Connection test failed.');
