export function shouldShowTopPillRunControls(_expanded: boolean, hasRunControls: boolean): boolean {
  return hasRunControls;
}

export function shouldShowTopPillStopControl(isProcessing: boolean, hasStopHandler: boolean): boolean {
  return isProcessing && hasStopHandler;
}
