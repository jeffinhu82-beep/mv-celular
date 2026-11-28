export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown> & { issues?: { path: string; message: string }[]; permission?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorBody['details'];

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }

  fieldErrors(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const issue of this.details?.issues ?? []) {
      if (!result[issue.path]) result[issue.path] = issue.message;
    }
    return result;
  }
}

export interface ApprovalCredentials {
  login: string;
  password: string;
}

type ApprovalHandler = (request: { permission: string; message: string; error?: string }) => Promise<ApprovalCredentials | null>;

let approvalHandler: ApprovalHandler | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApprovalHandler(handler: ApprovalHandler | null) {
  approvalHandler = handler;
}

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
  }
  try {
    return await fetch(url, init);
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' });
  }
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const data = (await response.json()) as { error?: ApiErrorBody };
    if (data.error) return new ApiError(response.status, data.error);
  } catch {}
  return new ApiError(response.status, { code: 'HTTP', message: 'Erro inesperado no servidor. Tente de novo.' });
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let payload = body;
  let lastError: string | undefined;
  for (;;) {
    const response = await send(method, url, payload);
    if (response.ok) {
      if (response.status === 204) return undefined as T;
      const type = response.headers.get('content-type') ?? '';
      return (type.includes('application/json') ? await response.json() : await response.text()) as T;
    }
    const error = await readError(response);
    if (response.status === 401 && !url.startsWith('/api/auth/login')) unauthorizedHandler?.();
    const approvable = error.code === 'APPROVAL_REQUIRED' || error.code === 'APPROVAL_INVALID';
    if (!approvable || !approvalHandler || payload instanceof FormData) throw error;
    if (error.code === 'APPROVAL_INVALID') lastError = error.message;
    const credentials = await approvalHandler({
      permission: String(error.details?.permission ?? ''),
      message: error.code === 'APPROVAL_REQUIRED' ? error.message : 'Esta ação precisa de autorização.',
      ...(lastError ? { error: lastError } : {}),
    });
    if (!credentials) throw new ApiError(403, { code: 'APPROVAL_CANCELLED', message: 'Autorização cancelada.' });
    payload = { ...((payload as object | undefined) ?? {}), approval: credentials };
  }
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  delete: <T>(url: string, body?: unknown) => request<T>('DELETE', url, body),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const first = error.details?.issues?.[0];
    if (error.code === 'VALIDATION' && first) return first.message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Algo deu errado. Tente de novo.';
}
