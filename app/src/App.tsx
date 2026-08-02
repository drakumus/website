import { Routes, Route } from 'react-router';
import Landing from './pages/Landing';
import Portfolio from './pages/Portfolio';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/portfolio" element={<Portfolio />} />
    </Routes>
  );
}
