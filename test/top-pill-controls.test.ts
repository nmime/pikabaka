import t from 'tap';
import { shouldShowTopPillRunControls, shouldShowTopPillStopControl } from '../src/components/ui/topPillControls';

t.test('top pill owns one global run-control set in both expanded and collapsed states', (t) => {
  t.equal(shouldShowTopPillRunControls(true, true), true, 'expanded overlay keeps the single top-pill control set');
  t.equal(shouldShowTopPillRunControls(false, true), true, 'collapsed overlay keeps compact controls available');
  t.equal(shouldShowTopPillRunControls(false, false), false, 'no handlers means no controls');
  t.end();
});

t.test('top pill stop only appears while there is active work to stop', (t) => {
  t.equal(shouldShowTopPillStopControl(false, true), false, 'idle/ready state does not show a duplicate Stop next to Quit');
  t.equal(shouldShowTopPillStopControl(true, true), true, 'processing state still exposes Stop');
  t.equal(shouldShowTopPillStopControl(true, false), false, 'no handler means no Stop');
  t.end();
});
