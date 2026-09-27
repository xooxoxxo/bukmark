import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import { SetupScreen } from './SetupScreen';
import { makeWrapper } from '../test/utils';

// Keep the real ApiError and errorMessage so the error path renders real text.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, setupOwner: vi.fn() };
});

function renderSetup() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <SetupScreen />
    </Wrapper>,
  );
}

function submit(password: string, confirm: string) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: confirm } });
  fireEvent.click(screen.getByRole('button', { name: 'Create password' }));
}

describe('SetupScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders setup form with password fields', () => {
    renderSetup();
    expect(screen.getByRole('heading', { name: 'Set up bukmark' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create password' })).toBeInTheDocument();
  });

  it('states the length rule up front and ties it to the password field', () => {
    renderSetup();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      /At least 12 characters/,
    );
  });

  it('submits a valid password', async () => {
    vi.mocked(client.setupOwner).mockResolvedValue({ ok: true });
    renderSetup();
    submit('validpassword123', 'validpassword123');
    await waitFor(() => expect(client.setupOwner).toHaveBeenCalledWith('validpassword123'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts characters the way the server does, so 6 emoji are too short', async () => {
    renderSetup();
    // 6 emoji are 12 UTF-16 units but only 6 characters.
    submit('🔖'.repeat(6), '🔖'.repeat(6));
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 12 characters');
    expect(client.setupOwner).not.toHaveBeenCalled();
  });

  it('accepts 12 emoji as 12 characters', async () => {
    vi.mocked(client.setupOwner).mockResolvedValue({ ok: true });
    renderSetup();
    submit('🔖'.repeat(12), '🔖'.repeat(12));
    await waitFor(() => expect(client.setupOwner).toHaveBeenCalledWith('🔖'.repeat(12)));
  });

  it('rejects a password over 1024 characters before calling the server', async () => {
    renderSetup();
    submit('a'.repeat(1025), 'a'.repeat(1025));
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 1024 characters');
    expect(client.setupOwner).not.toHaveBeenCalled();
  });

  it('announces mismatched passwords on the confirm field', async () => {
    renderSetup();
    submit('validpassword123', 'different123');

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match');
    const confirm = screen.getByLabelText('Confirm password');
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(confirm).toHaveFocus();
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');
    expect(client.setupOwner).not.toHaveBeenCalled();
  });

  it('announces a short password on the password field', async () => {
    renderSetup();
    submit('short', 'short');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Password must be at least 12 characters',
    );
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveFocus();
    expect(client.setupOwner).not.toHaveBeenCalled();
  });

  it('shows the server error and keeps the fields usable', async () => {
    vi.mocked(client.setupOwner).mockRejectedValue(new ApiError('Too many setup attempts', 429));
    renderSetup();
    submit('validpassword123', 'validpassword123');

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many setup attempts');
    const password = screen.getByLabelText('Password');
    expect(password).not.toBeDisabled();
    expect(password).not.toHaveAttribute('readonly');
    expect(password).toHaveFocus();
  });
});
