import './theme.css';
import { Ticker } from './Ticker';
import { Toolbar } from './Toolbar';
import { WindowManager } from './WindowManager';

// Mounts the DOM UI overlay (toolbar, ticker, window layer) into #ui-root.
// The root stays pointer-events:none; widgets opt back in, so the Phaser
// canvas keeps receiving all other input.
export function initUI(): void {
  const uiRoot = document.getElementById('ui-root');
  if (!uiRoot) throw new Error('#ui-root missing from index.html');
  const windows = new WindowManager(uiRoot);
  new Ticker(uiRoot);
  new Toolbar(uiRoot, windows);
}
