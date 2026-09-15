import Home from './pages/Home';
import Terminal from './pages/Terminal';

export default function App() {
  const path = window.location.pathname;
  if (path === '/term') return <Terminal />;
  return <Home />;
}
