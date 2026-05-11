export function isPollingVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible'
}

