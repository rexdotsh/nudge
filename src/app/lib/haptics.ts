let label: HTMLLabelElement | undefined;

// iOS has no vibration API; toggling a native switch control produces the system haptic tick (iOS 18+).
export function tick(): void {
  if (!label) {
    label = document.createElement('label');
    label.className = 'sr-only';
    label.ariaHidden = 'true';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.append(input);
    document.body.append(label);
  }
  label.click();
}
