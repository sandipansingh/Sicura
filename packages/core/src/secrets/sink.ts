import { redactText } from './redact';
import { AppError } from '../errors';

/** Redact individual string values, preserving JSON structure and enum fields. */
export function redactValue<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (redactText(key) !== key) throw new AppError('SINK_KEY_INVALID');
        return [key, redactValue(item)];
      }),
    ) as T;
  }
  return value;
}
