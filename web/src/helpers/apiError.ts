import { isAxiosError } from 'axios';

// Older routes use { error }; newer routes use { message } or a plain string.
export function getApiErrorMessage(error: unknown): string | undefined {
  if (!isAxiosError(error)) {
    return undefined;
  }

  const data: unknown = error.response?.data;
  if (typeof data === 'string' && data.trim().length > 0) {
    return data;
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string' &&
    data.message.trim().length > 0
  ) {
    return data.message;
  }

  if (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'string' &&
    data.error.trim().length > 0
  ) {
    return data.error;
  }

  return undefined;
}

// Whether a lookup by id failed because nothing has that id: the server
// answers 404 for an unknown id and 400 for one that isn't an id at all
export function isMissingEntityError(error: unknown): boolean {
  if (!isAxiosError(error)) {
    return false;
  }
  const status = error.response?.status;
  return status === 404 || status === 400;
}

// What to tell the user about an error: the server's own message for a failed
// API call, else the error's own message
export function describeError(error: unknown): string | undefined {
  const apiMessage = getApiErrorMessage(error);
  if (apiMessage !== undefined) {
    return apiMessage;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }
  return undefined;
}
