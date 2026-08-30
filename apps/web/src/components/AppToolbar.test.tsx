import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AppToolbar } from './AppToolbar';

describe('AppToolbar', () => {
  it('keeps export available without rendering aggregate stats', () => {
    render(
      <MemoryRouter>
        <AppToolbar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('banner', { name: 'Application toolbar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.queryByText(/links|active|archived|hubs|unassigned/)).not.toBeInTheDocument();
  });
});
