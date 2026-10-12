/** A picker chip hides a native date or time field; with a mouse, clicking it would only focus one segment of that
 * field, so it opens the platform picker instead. Touch opens it natively. */
export function openPicker(event: MouseEvent & { currentTarget: HTMLInputElement }): void {
  if (matchMedia('(pointer: fine)').matches && 'showPicker' in event.currentTarget) event.currentTarget.showPicker();
}
