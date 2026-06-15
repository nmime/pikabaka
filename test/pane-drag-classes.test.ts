import t from 'tap';
import { PANE_HEADER_DRAG_CLASS, PANE_INTERACTIVE_CLASS } from '../src/components/meeting/paneDragClasses';

t.test('pane headers are draggable while pane controls can stay no-drag', (t) => {
  t.equal(PANE_HEADER_DRAG_CLASS, 'draggable-area');
  t.equal(PANE_INTERACTIVE_CLASS, 'no-drag');
  t.end();
});
