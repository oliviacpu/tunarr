import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, test } from 'vitest';
import {
  describeError,
  getApiErrorMessage,
  isMissingEntityError,
} from './apiError.ts';

const responseError = (data: unknown) =>
  new AxiosError(
    'Request failed with status code 400',
    'ERR_BAD_REQUEST',
    {
      headers: new AxiosHeaders(),
    },
    undefined,
    {
      data,
      status: 400,
      statusText: 'Bad Request',
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );

describe('getApiErrorMessage', () => {
  test('returns a plain string body', () => {
    const message =
      'Slot 0 references custom show abc, which has no content to schedule';
    expect(getApiErrorMessage(responseError(message))).toBe(message);
  });

  test('returns a message field from an object body', () => {
    expect(getApiErrorMessage(responseError({ message: 'Bad slot' }))).toBe(
      'Bad slot',
    );
  });

  test('returns the legacy channel error field', () => {
    const error = 'Transcode config with ID missing not found';
    expect(getApiErrorMessage(responseError({ error }))).toBe(error);
    expect(describeError(responseError({ error }))).toBe(error);
  });

  test('prefers a nonempty message over a legacy error', () => {
    expect(
      getApiErrorMessage(
        responseError({ message: 'Current message', error: 'Legacy error' }),
      ),
    ).toBe('Current message');
    expect(
      getApiErrorMessage(
        responseError({ message: ' ', error: 'Legacy error' }),
      ),
    ).toBe('Legacy error');
  });

  test.each([
    null,
    {},
    { error: '' },
    { error: ' ' },
    { error: { message: 'Not a string' } },
    { message: '' },
    { message: ' ' },
  ])('ignores empty or malformed error bodies: %j', (data) => {
    expect(getApiErrorMessage(responseError(data))).toBeUndefined();
  });

  test('ignores an empty body', () => {
    expect(getApiErrorMessage(responseError(''))).toBeUndefined();
  });

  test('ignores errors that did not come from the API client', () => {
    expect(getApiErrorMessage(new Error('boom'))).toBeUndefined();
    expect(getApiErrorMessage('boom')).toBeUndefined();
  });
});

const statusError = (status: number) =>
  new AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST',
    { headers: new AxiosHeaders() },
    undefined,
    {
      data: '',
      status,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
    },
  );

describe('isMissingEntityError', () => {
  test('is true for an unknown id (404) and for a malformed one (400)', () => {
    expect(isMissingEntityError(statusError(404))).toBe(true);
    expect(isMissingEntityError(statusError(400))).toBe(true);
  });

  test('is false for server failures and for errors without a response', () => {
    expect(isMissingEntityError(statusError(500))).toBe(false);
    expect(
      isMissingEntityError(new AxiosError('Network Error', 'ERR_NETWORK')),
    ).toBe(false);
    expect(isMissingEntityError(new Error('boom'))).toBe(false);
  });
});

describe('describeError', () => {
  test("prefers the server's message to the client's", () => {
    expect(describeError(responseError('Channel 4 has no lineup'))).toBe(
      'Channel 4 has no lineup',
    );
  });

  test("falls back to the error's own message", () => {
    expect(describeError(statusError(500))).toBe(
      'Request failed with status code 500',
    );
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('boom')).toBe('boom');
  });

  test('has nothing to say about an empty or unknown error', () => {
    expect(describeError(new Error(''))).toBeUndefined();
    expect(describeError(undefined)).toBeUndefined();
    expect(describeError({ status: 500 })).toBeUndefined();
  });
});
