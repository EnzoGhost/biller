import { describe, it, expect } from 'vitest';
import { formatPhone, displayPhone } from '../lib/format';

describe('Phone formatting', () => {
  describe('formatPhone', () => {
    it('should format 10-digit number', () => {
      expect(formatPhone('7875551234')).toBe('(787) 555-1234');
    });

    it('should handle partial numbers', () => {
      expect(formatPhone('787')).toBe('787');
      expect(formatPhone('787555')).toBe('(787) 555');
    });

    it('should strip non-digits', () => {
      expect(formatPhone('(787) 555-1234')).toBe('(787) 555-1234');
    });

    it('should handle empty string', () => {
      expect(formatPhone('')).toBe('');
    });
  });

  describe('displayPhone', () => {
    it('should handle null/undefined', () => {
      expect(displayPhone(null)).toBe('');
      expect(displayPhone(undefined)).toBe('');
    });

    it('should handle empty string', () => {
      expect(displayPhone('')).toBe('');
    });

    it('should format 10-digit number', () => {
      expect(displayPhone('7875551234')).toBe('(787) 555-1234');
    });

    it('should format 7-digit number', () => {
      expect(displayPhone('5551234')).toBe('555-1234');
    });

    it('should return non-standard lengths as-is', () => {
      expect(displayPhone('123')).toBe('123');
    });
  });
});
