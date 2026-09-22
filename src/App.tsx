import Home from './pages/Home';
import Terminal from './pages/Terminal';
import Updater from './pages/Updater';

export default function App() {
  const path = window.location.pathname;
  const hash = window.location.hash;
  const search = window.location.search;

  if (path === '/updater' || hash === '#updater' || search.includes('page=updater')) {
    return <Updater />;
  }
  if (path === '/term') return <Terminal />;
  return <Home />;
}
