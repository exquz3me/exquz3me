(() => {
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  const key = 'exquz3me-theme';
  const frameThemes = new WeakMap();
  let preference = null;
  let theme;

  try {
    const saved = localStorage.getItem(key);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // System preference still works when storage is unavailable.
  }

  function syncGuestbook(force = false) {
    const widgetTheme = theme === 'dark' ? 'transparent_dark' : 'light';
    const script = document.querySelector('script[data-repo]');
    if (script) script.dataset.theme = widgetTheme;
    const frame = document.querySelector('iframe.giscus-frame');
    if (!frame || (!force && frameThemes.get(frame) === widgetTheme)) return;
    frameThemes.set(frame, widgetTheme);
    frame.contentWindow.postMessage(
      { giscus: { setConfig: { theme: widgetTheme } } },
      'https://giscus.app',
    );
  }

  function applyTheme() {
    theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.content = theme === 'dark' ? '#010101' : '#fff';
    });
    const icon = document.querySelector('link[rel="icon"]');
    if (icon) icon.setAttribute('href', `/media/svg/favicon.svg#${theme}`);
    const button = document.querySelector('.theme-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.title = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;
    }
    syncGuestbook();
  }

  // Run before the page styles load to avoid flashing the wrong saved theme.
  applyTheme();

  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('.top');
    const navigation = header?.querySelector('nav');
    header?.addEventListener('click', event => {
      if (event.target.closest('a, button')) return;
      navigation?.focus({ preventScroll: true });
    });
    const button = document.querySelector('.theme-toggle');
    if (button) {
      button.hidden = false;
      button.addEventListener('click', () => {
        preference = theme === 'dark' ? 'light' : 'dark';
        try {
          localStorage.setItem(key, preference);
        } catch {
          // Keep the choice for this page even if it cannot be saved.
        }
        applyTheme();
      });
    }
    applyTheme();
  }, { once: true });

  system.addEventListener('change', () => {
    if (!preference) applyTheme();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = ['light', 'dark'].includes(event.newValue) ? event.newValue : null;
    applyTheme();
  });
  window.addEventListener('load', event => {
    if (event.target instanceof HTMLIFrameElement && event.target.matches('.giscus-frame')) {
      syncGuestbook(true);
    }
  }, true);
  window.addEventListener('message', event => {
    const frame = document.querySelector('iframe.giscus-frame');
    if (event.origin === 'https://giscus.app' && event.source === frame?.contentWindow && event.data?.giscus?.resizeHeight) {
      syncGuestbook();
    }
  });
})();
