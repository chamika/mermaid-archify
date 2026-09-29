import { render } from 'preact';
import { App } from './app/App';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
import './app/app.css';

try {
  const saved = localStorage.getItem('mermaid-archify:theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {
  /* storage unavailable */
}

render(<App />, document.getElementById('root')!);
