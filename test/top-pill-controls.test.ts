import t from 'tap';
import { shouldShowTopPillRunControls } from '../src/components/ui/topPillControls';

t.test('top pill owns one global run-control set in both expanded and collapsed states', (t) => {
  t.equal(shouldShowTopPillRunControls(true, true), true, 'expanded overlay keeps the single top-pill pause/stop set');
  t.equal(shouldShowTopPillRunControls(false, true), true, 'collapsed overlay keeps compact pause/stop available');
  t.equal(shouldShowTopPillRunControls(false, false), false, 'no handlers means no controls');
  t.end();
});
