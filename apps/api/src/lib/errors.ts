export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, message, 'BAD_REQUEST', details);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, message, 'FORBIDDEN');
export const notFound = (message = 'Registro não encontrado.') => new AppError(404, message, 'NOT_FOUND');
export const conflict = (message: string, details?: unknown) => new AppError(409, message, 'CONFLICT', details);
export const unprocessable = (message: string, code = 'UNPROCESSABLE', details?: unknown) =>
  new AppError(422, message, code, details);

export const fieldError = (path: string, message: string) =>
  new AppError(400, message, 'VALIDATION', { issues: [{ path, message }] });
