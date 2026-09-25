import Home from './pages/Home';
import Terminal from './pages/Terminal';
import Updater from './pages/Updater';
import { CustomScriptExecutionProvider } from './contexts/CustomScriptExecutionContext';
import { ScriptModal } from './components/ScriptModal';
import { ScriptDock } from './components/ScriptDock';

export default function App() {
  const path = window.location.pathname;
  const hash = window.location.hash;
  const search = window.location.search;

  if (path === '/updater' || hash === '#updater' || search.includes('page=updater')) {
    return <Updater />;
  }

  const content = path === '/term' ? <Terminal /> : <Home />;

  return (
    <CustomScriptExecutionProvider>
      {content}
      <ScriptModal />
      <ScriptDock />
    </CustomScriptExecutionProvider>
  );
}
