<div class="titlebar" aria-hidden="true">Nudge</div>

<style>
  .titlebar {
    display: none;
  }

  @media (display-mode: window-controls-overlay) {
    .titlebar {
      position: fixed;
      top: env(titlebar-area-y, 0px);
      left: env(titlebar-area-x, 0px);
      z-index: 40;
      width: env(titlebar-area-width, 100%);
      height: env(titlebar-area-height, 0px);
      display: flex;
      align-items: center;
      padding: 0 16px;
      background: var(--bg);
      color: var(--muted);
      font-size: 12px;
      -webkit-app-region: drag;
      user-select: none;
    }
  }
</style>
