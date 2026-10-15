/** Generate the Godot panel input from the TypeScript layout oracle. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DECIMAL_ANGLES,
  MATRIX_ORDER,
  PANEL_ASPECT,
  PANEL_BANDS,
  PANEL_COMPONENTS,
  PANEL_CONTROLS,
  PANEL_HOLES,
  PANEL_LEGENDS,
  PANEL_LINEWORK,
  PANEL_PLATES,
  PANEL_REGIONS,
  PANEL_TERMINALS,
  PH2_HORIZONTAL,
  PH2_HORIZONTAL_SOURCE,
  PH2_POWER_STRIPE,
} from '../src/ui/panel-layout.ts';

const OUTPUT = fileURLToPath(new URL('../data/panel-layout.json', import.meta.url));
const NOTE = 'panel.md §11 — absolute dimensions and jack pitch are not settled by any source; every placement here is an unverified redraw token';

const layout = {
  schema: 'minivac.panel-layout/1',
  sources: { ph2HorizontalSource: PH2_HORIZONTAL_SOURCE, note: NOTE },
  aspect: PANEL_ASPECT,
  ph2Horizontal: PH2_HORIZONTAL,
  ph2PowerStripe: PH2_POWER_STRIPE,
  plates: PANEL_PLATES,
  bands: PANEL_BANDS,
  regions: PANEL_REGIONS,
  terminals: PANEL_TERMINALS,
  holes: PANEL_HOLES,
  legends: PANEL_LEGENDS,
  components: PANEL_COMPONENTS,
  controls: PANEL_CONTROLS,
  linework: PANEL_LINEWORK,
  matrixOrder: MATRIX_ORDER,
  decimalAngles: DECIMAL_ANGLES,
};

writeFileSync(OUTPUT, JSON.stringify(layout, null, 2) + '\n', 'utf8');
