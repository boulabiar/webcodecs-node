/**
 * Input validation utilities
 */

import { DOMException } from '../types/index.js';

/**
 * Validate that a value is a positive integer
 */
export function validatePositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return value;
}

/**
 * Validate that a value is a non-negative integer
 */
export function validateNonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
  return value;
}

/**
 * Validate that a value is a finite number
 */
export function validateFiniteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return value;
}

/**
 * Validate that an object is not null or undefined
 */
export function validateRequired<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new TypeError(`${name} is required`);
  }
  return value;
}

/**
 * Validate that a string is not empty
 */
export function validateNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate codec state is configured
 */
export function validateConfigured(state: string, operation: string): void {
  if (state !== 'configured') {
    throw new DOMException(
      `Cannot ${operation} on ${state} codec`,
      'InvalidStateError'
    );
  }
}

/**
 * Validate codec is not closed
 */
export function validateNotClosed(state: string): void {
  if (state === 'closed') {
    throw new DOMException('Codec is closed', 'InvalidStateError');
  }
}
