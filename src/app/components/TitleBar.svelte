<div class="titlebar" aria-hidden="true"><span>Nudge</span></div>

<style>
  /* Installed on iOS, whatever scrolls under the status bar is blurred unless an opaque fixed element covers it. */
  .titlebar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 40;
    width: 100%;
    height: env(safe-area-inset-top);
    background: var(--bg);
    view-transition-name: titlebar;
  }

  span {
    display: none;
  }

  @media (display-mode: window-controls-overlay) {
    .titlebar {
      top: env(titlebar-area-y, 0px);
      left: env(titlebar-area-x, 0px);
      width: env(titlebar-area-width, 100%);
      height: env(titlebar-area-height, 0px);
      display: flex;
      align-items: center;
      padding: 0 16px;
      color: var(--muted);
      font-size: 12px;
      -webkit-app-region: drag;
      user-select: none;
    }

    span {
      display: inline;
    }
  }
</style>
