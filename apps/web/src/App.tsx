import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { createQueryClient } from './api/queryClient';
import { AuthGate } from './components/AuthGate';
import { Layout } from './components/Layout';
import { HubPage } from './pages/HubPage';
import { LinksPage } from './pages/LinksPage';
import { SavePage } from './pages/SavePage';
import { TokensPage } from './pages/TokensPage';

const queryClient = createQueryClient();

export function AppRoutes() {
  return (
    <Routes>
      <Route path="save" element={<SavePage />} />
      <Route element={<Layout />}>
        <Route index element={<LinksPage />} />
        <Route path="hubs/:hubId" element={<HubPage />} />
        <Route path="settings/tokens" element={<TokensPage />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
