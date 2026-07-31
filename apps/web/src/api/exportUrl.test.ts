import { describe, expect, it } from 'vitest';
import { buildExportUrl } from './exportUrl';

describe('buildExportUrl', () => {
  it('includes the format', () => {
    expect(buildExportUrl({ format: 'json' })).toBe('/api/export?format=json');
  });

  it('omits empty and false filters rather than sending noise', () => {
    expect(buildExportUrl({ format: 'html', q: '', unassigned: false })).toBe(
      '/api/export?format=html',
    );
  });

  it('includes a search term', () => {
    expect(buildExportUrl({ format: 'csv', q: 'rust' })).toBe('/api/export?format=csv&q=rust');
  });

  it('url-encodes a search term with spaces and symbols', () => {
    expect(buildExportUrl({ format: 'csv', q: 'a b&c' })).toContain('q=a+b%26c');
  });

  it('includes the hub id', () => {
    expect(buildExportUrl({ format: 'html', hub: 'abc-123' })).toBe(
      '/api/export?format=html&hub=abc-123',
    );
  });

  it('includes unassigned only when true', () => {
    expect(buildExportUrl({ format: 'json', unassigned: true })).toBe(
      '/api/export?format=json&unassigned=true',
    );
  });

  it('includes an explicit status', () => {
    expect(buildExportUrl({ format: 'json', status: 'archived' })).toBe(
      '/api/export?format=json&status=archived',
    );
  });

  it('supports status=all for a full backup', () => {
    expect(buildExportUrl({ format: 'json', status: 'all' })).toBe(
      '/api/export?format=json&status=all',
    );
  });

  it('combines every filter', () => {
    const url = buildExportUrl({
      format: 'html', q: 'rust', hub: 'h1', unassigned: true, status: 'all',
    });
    expect(url).toContain('format=html');
    expect(url).toContain('q=rust');
    expect(url).toContain('hub=h1');
    expect(url).toContain('unassigned=true');
    expect(url).toContain('status=all');
  });
});
