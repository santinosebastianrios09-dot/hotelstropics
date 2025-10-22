export class AppError extends Error {
  constructor(message: string, public code: string = 'APP_ERROR', public cause?: unknown) {
    super(message);
    this.name = 'AppError';
  }
}
