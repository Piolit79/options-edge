import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Screener from './pages/Screener';
import OptionsChain from './pages/OptionsChain';
import TradeJournal from './pages/TradeJournal';
import Analytics from './pages/Analytics';
import AutoTrader from './pages/AutoTrader';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster theme="dark" position="top-right" />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/screener" element={<Screener />} />
            <Route path="/chain" element={<OptionsChain />} />
            <Route path="/journal" element={<TradeJournal />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/auto" element={<AutoTrader />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
