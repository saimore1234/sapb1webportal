import { apiClient } from './client';
import type {
  ApiResponse,
  CompanyOption,
  CreateServerConfigurationPayload,
  CurrentUser,
  LoginResponse,
  TestAllResult,
  TestConnectionPayload,
  TestConnectionResult
} from '../types';

/// Public list of configured SAP B1 companies for the login dropdown. Called
/// before the user is authenticated — never returns connection info.
export async function getCompanies(): Promise<CompanyOption[]> {
  const { data } = await apiClient.get<ApiResponse<CompanyOption[]>>('/auth/companies');
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Could not load the list of companies.');
  }
  return data.data;
}

export async function login(companyDb: string, username: string, password: string): Promise<LoginResponse> {
  const { data } = await apiClient.post<ApiResponse<LoginResponse>>('/auth/login', {
    companyDb,
    username,
    password
  });
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Login failed.');
  }
  return data.data;
}

/// The caller's identity + resolved permission set — used to gate navigation
/// and buttons client-side (UX only; the backend enforces independently).
export async function getMe(): Promise<CurrentUser> {
  const { data } = await apiClient.get<ApiResponse<CurrentUser>>('/auth/me');
  if (!data.success || !data.data) {
    throw new Error(data.message || 'Could not load the current user.');
  }
  return data.data;
}

/// Best-effort: tells the server to revoke the current token immediately. The
/// caller clears local auth state regardless of whether this succeeds (e.g.
/// the token may already be expired).
export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout');
}

/// Login-page company setup. Anonymous, but every call carries the portal
/// admin credential, which the server re-verifies before testing or saving.
export interface CompanySetupAdmin {
  adminUsername: string;
  adminPassword: string;
}

async function companySetup<T>(path: string, admin: CompanySetupAdmin, configuration: object, failMessage: string): Promise<T> {
  const { data } = await apiClient.post<ApiResponse<T>>(`/auth/company-setup${path}`, { ...admin, configuration });
  if (!data.success || data.data === null || data.data === undefined) {
    throw new Error(data.message || failMessage);
  }
  return data.data;
}

export const setupTestAll = (admin: CompanySetupAdmin, payload: TestConnectionPayload) =>
  companySetup<TestAllResult>('/test', admin, payload, 'Connection test failed.');
export const setupTestSql = (admin: CompanySetupAdmin, payload: TestConnectionPayload) =>
  companySetup<TestConnectionResult>('/test-sql', admin, payload, 'SQL connection test failed.');
export const setupTestSap = (admin: CompanySetupAdmin, payload: TestConnectionPayload) =>
  companySetup<TestConnectionResult>('/test-sap', admin, payload, 'SAP connection test failed.');
export const setupCreateCompany = (admin: CompanySetupAdmin, payload: CreateServerConfigurationPayload) =>
  companySetup<{ id: number; code: string }>('', admin, payload, 'Failed to save company configuration.');
