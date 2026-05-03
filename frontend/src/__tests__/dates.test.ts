import { describe, it, expect } from 'vitest';
import { formatDate, formatDateShort, formatDateTime, formatRelative, toISODate } from '../lib/dates';

describe('Date utilities', () => {
  describe('formatDate', () => {
    it('should handle null/undefined gracefully', () => {
      expect(formatDate(null)).toBe('—');
      expect(formatDate(undefined)).toBe('—');
    });

    it('should handle empty string', () => {
      expect(formatDate('')).toBe('—');
    });

    it('should handle invalid date strings', () => {
      expect(formatDate('not-a-date')).toBe('—');
      expect(formatDate('<!doctype html>')).toBe('—');
    });

    it('should format valid date-only strings as local dates', () => {
      const result = formatDate('2026-04-23');
      expect(result).toBeTruthy();
      expect(result).not.toBe('—');
      // Should contain "23" regardless of locale
      expect(result).toContain('23');
    });

    it('should handle Date objects', () => {
      const result = formatDate(new Date(2026, 3, 23));
      expect(result).toBeTruthy();
      expect(result).not.toBe('—');
    });
  });

  describe('formatDateShort', () => {
    it('should handle null/undefined gracefully', () => {
      expect(formatDateShort(null)).toBe('—');
      expect(formatDateShort(undefined)).toBe('—');
    });

    it('should handle invalid input', () => {
      expect(formatDateShort('garbage')).toBe('—');
    });
  });

  describe('formatDateTime', () => {
    it('should handle null/undefined gracefully', () => {
      expect(formatDateTime(null)).toBe('—');
      expect(formatDateTime(undefined)).toBe('—');
    });
  });

  describe('formatRelative', () => {
    it('should handle null/undefined gracefully', () => {
      expect(formatRelative(null)).toBe('—');
      expect(formatRelative(undefined)).toBe('—');
    });

    it('should handle invalid dates', () => {
      expect(formatRelative('not-a-date')).toBe('—');
    });
  });

  describe('toISODate', () => {
    it('should handle null/undefined gracefully', () => {
      expect(toISODate(null)).toBe('');
      expect(toISODate(undefined)).toBe('');
    });

    it('should handle invalid dates', () => {
      expect(toISODate('garbage')).toBe('');
    });

    it('should return YYYY-MM-DD for valid dates', () => {
      expect(toISODate('2026-04-23')).toBe('2026-04-23');
    });

    it('should not shift dates due to timezone', () => {
      // This was the actual bug — date-only strings parsed as UTC would shift
      const result = toISODate('2026-04-23');
      expect(result).toBe('2026-04-23'); // NOT 2026-04-22
    });
  });
});
