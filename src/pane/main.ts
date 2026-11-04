// The dev page's entry (dev.html): the console as the public page composes it, plus the chat pane
// beside it. `vite build` builds only index.html, so none of this reaches dist/.
import { startApp } from '../app.ts';
import { mountPane, readPaneLink } from './ui.ts';

const app = startApp();
const root = document.querySelector<HTMLElement>('#pane');
if (root === null) throw new Error('pane: missing #pane mount point');
mountPane(root, app, readPaneLink(window.location.hash));
