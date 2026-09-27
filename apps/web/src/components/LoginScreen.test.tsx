import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../api/client';
import { ApiError } from '../api/client';
import { LoginScreen } from './LoginScreen';
import { makeWrapper } from '../test/utils';

// Keep the real ApiError and errorMessage so the error path renders real text.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return { ...actual, login: vi.fn() };
});

function renderLogin() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <LoginScreen />
    </Wrapper>,
  );
}

function submit(password: string) {
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form with a focused password field', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('submits the password', async () => {
    vi.mocked(client.login).mockResolvedValue({ ok: true });
    renderLogin();
    submit('mypassword');
    await waitFor(() => expect(client.login).toHaveBeenCalledWith('mypassword'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces a wrong password and puts focus back on the field', async () => {
    vi.mocked(client.login).mockRejectedValue(new ApiError('Wrong password', 401, 'bad_password'));
    renderLogin();
    submit('not it');

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong password');
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Wrong password');
    expect(input).toHaveFocus();
  });

  it('keeps the field focusable while the request is pending', async () => {
    vi.mocked(client.login).mockReturnValue(new Promise(() => {}));
    renderLogin();
    submit('mypassword');

    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled();
    const input = screen.getByLabelText('Password');
    expect(input).not.toBeDisabled();
    expect(input).toHaveAttribute('readonly');
  });
});
