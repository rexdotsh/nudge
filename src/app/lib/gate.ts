export class ForegroundGate {
  private generation = 0;

  constructor(private visible: boolean) {}

  changed(visible: boolean): void {
    this.generation++;
    this.visible = visible;
  }

  attempt(): () => boolean {
    const generation = this.generation;
    return () => this.visible && generation === this.generation;
  }
}
