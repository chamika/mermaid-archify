import architectureBeta from './architecture-beta.mmd?raw';
import classDiagram from './class.mmd?raw';
import er from './er.mmd?raw';
import flowchart from './architecture-flowchart.mmd?raw';
import sequence from './sequence.mmd?raw';
import state from './state.mmd?raw';

export const SAMPLES = [
  { id: 'flowchart', label: 'Flowchart · architecture', source: flowchart },
  { id: 'sequence', label: 'Sequence · cache miss', source: sequence },
  { id: 'state', label: 'State · build lifecycle', source: state },
  { id: 'er', label: 'ER · order data model', source: er },
  { id: 'class', label: 'Class · payments domain', source: classDiagram },
  { id: 'architecture', label: 'architecture-beta', source: architectureBeta },
] as const;
