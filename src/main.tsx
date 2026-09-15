import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// No StrictMode: the terminal page owns imperative resources (a WebSocket and
// an xterm.js instance bound to a live PTY session) that don't tolerate
// StrictMode's mount/cleanup/remount effect probing.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
