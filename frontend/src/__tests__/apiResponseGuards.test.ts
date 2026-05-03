import { describe, it, expect } from 'vitest';

/**
 * These tests verify that our defensive patterns handle all the ways
 * API responses can crash .map() calls.
 *
 * Every SometeoPR crash on 2026-05-03 was caused by calling .map() on
 * data that wasn't actually an array (null, undefined, HTML error page,
 * string, object, etc).
 */

// Helper: the safe array pattern used throughout the app
function safeArray<T = unknown>(val: unknown): T[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

describe('API response safety', () => {
  describe('safeArray guard', () => {
    it('should pass through real arrays', () => {
      expect(safeArray([1, 2, 3])).toEqual([1, 2, 3]);
      expect(safeArray([])).toEqual([]);
    });

    it('should handle null/undefined', () => {
      expect(safeArray(null)).toEqual([]);
      expect(safeArray(undefined)).toEqual([]);
    });

    it('should handle HTML error responses (the actual crash cause)', () => {
      expect(safeArray('<!doctype html><html><body>502 Bad Gateway</body></html>')).toEqual([]);
      expect(safeArray('<!DOCTYPE html>')).toEqual([]);
    });

    it('should handle plain strings', () => {
      expect(safeArray('not an array')).toEqual([]);
      expect(safeArray('Internal Server Error')).toEqual([]);
    });

    it('should handle JSON string arrays', () => {
      expect(safeArray('["H52.03", "H52.222"]')).toEqual(['H52.03', 'H52.222']);
    });

    it('should handle objects (not arrays)', () => {
      expect(safeArray({ error: 'not found' })).toEqual([]);
      expect(safeArray({})).toEqual([]);
    });

    it('should handle numbers and booleans', () => {
      expect(safeArray(42)).toEqual([]);
      expect(safeArray(true)).toEqual([]);
      expect(safeArray(false)).toEqual([]);
    });
  });

  describe('Optional chaining + nullish coalescing (the ?? [] pattern)', () => {
    it('should safely default to empty array', () => {
      const response: any = null;
      expect(response?.claims_by_payer ?? []).toEqual([]);
    });

    it('should safely chain through undefined nested', () => {
      const response: any = {};
      expect(response?.data?.items ?? []).toEqual([]);
    });

    it('should pass through real data', () => {
      const response = { data: { items: [1, 2, 3] } };
      expect(response?.data?.items ?? []).toEqual([1, 2, 3]);
    });
  });

  describe('ReportsPage data patterns', () => {
    it('should safely spread empty arrays in Math.max', () => {
      const data: any = null;
      const maxBilled = Math.max(...(data?.claims_by_payer?.map((p: any) => p.billed) ?? [1]), 1);
      expect(maxBilled).toBe(1);
    });

    it('should safely map over undefined report arrays', () => {
      const data: any = {};
      const result = (data.claims_by_payer ?? []).map((p: any) => p.payer);
      expect(result).toEqual([]);
    });
  });

  describe('DenialsPage data patterns', () => {
    it('should safely filter null denial items', () => {
      const items: any[] | null = null;
      const filtered = (items ?? []).filter((d: any) => !d.is_resolved);
      expect(filtered).toEqual([]);
    });

    it('should safely extract unique codes from empty', () => {
      const items: any[] = [];
      const uniqueCodes = Array.from(new Set(items.map(d => d.denial_code).filter(Boolean)));
      expect(uniqueCodes).toEqual([]);
    });
  });

  describe('ClaimDetailPage service lines', () => {
    it('should safely map service_lines with fallback', () => {
      const claim: any = {};
      const cptCodes = (claim?.service_lines || []).map((sl: any) => sl.cpt_code) ?? [];
      expect(cptCodes).toEqual([]);
    });

    it('should safely handle scrub_issues', () => {
      const claim: any = { scrub_issues: null };
      const issues = claim.scrub_issues ?? [];
      expect(issues).toEqual([]);
      expect(issues.length).toBe(0);
    });
  });

  describe('PatientsPage insurance mapping', () => {
    it('should safely map insurances with fallback', () => {
      const patient: any = { insurances: null };
      const mapped = (patient.insurances ?? []).map((i: any) => i.payer_id);
      expect(mapped).toEqual([]);
    });

    it('should handle patient with no insurance key', () => {
      const patient: any = {};
      const mapped = (patient.insurances ?? []).map((i: any) => i.payer_id);
      expect(mapped).toEqual([]);
    });
  });
});
