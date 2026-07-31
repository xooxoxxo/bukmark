import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExportButton } from './ExportButton';
import { useFilters } from '../state/filters';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<ExportButton />} />
        <Route path="/hubs/:hubId" element={<ExportButton />} />
      </Routes>
    </MemoryRouter>,
  );
}

function hrefFor(label: string): string {
  return screen.getByRole('link', { name: label }).getAttribute('href') ?? '';
}

describe('ExportButton', () => {
  beforeEach(() => { useFilters.getState().reset(); });

  it('offers the three formats once opened', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByRole('link', { name: /HTML/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^JSON/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /CSV/ })).toBeInTheDocument();
  });

  it('exports the unfiltered view by default', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(hrefFor('HTML')).toBe('/api/export?format=html&status=active');
  });

  it('carries the search term from the filter store', () => {
    useFilters.getState().setQ('rust');
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(hrefFor('CSV')).toContain('q=rust');
  });

  it('carries the unassigned filter', () => {
    useFilters.getState().setUnassigned(true);
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(hrefFor('CSV')).toContain('unassigned=true');
  });

  it('carries the hub id from the route, which is not in the filter store', () => {
    renderAt('/hubs/hub-42');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(hrefFor('HTML')).toContain('hub=hub-42');
  });

  it('offers a full backup that ignores the current view', () => {
    useFilters.getState().setQ('rust');
    renderAt('/hubs/hub-42');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    const href = hrefFor('Full backup (JSON)');
    expect(href).toContain('status=all');
    expect(href).not.toContain('q=rust');
    expect(href).not.toContain('hub=hub-42');
  });

  it('sets the download attribute so the browser saves rather than navigates', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    expect(screen.getByRole('link', { name: 'HTML' })).toHaveAttribute('download');
  });

  it('keeps the menu closed until asked', () => {
    renderAt('/');
    expect(screen.queryByRole('link', { name: 'HTML' })).not.toBeInTheDocument();
  });
});
