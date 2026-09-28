import { render } from 'preact';
import { App } from './app/App';
import './app/app.css';

try {
  const saved = localStorage.getItem('mermaid-archify:theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  /* storage unavailable */
}

render(<App />, document.getElementById('root')!);
