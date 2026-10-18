(() => {
  const page = document.querySelector('.page');
  const svg = document.querySelector('.background-line svg');
  if (!page || !svg) return;
  const heading = page.querySelector('#work-title');
  const ns = 'http://www.w3.org/2000/svg';
  const measure = document.createElement('canvas').getContext('2d');
  const line = svg.querySelector('.routed-line');
  const route = line.getAttribute('d');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let scheduled = 0;
  let scrollFrame = 0;
  let progress = 0;
  let length = 0;
  let routeHeight = 0;
  let pageTop = 0;
  let initialEdge = 0;
  let maxScroll = 0;
  const textElements = page.querySelectorAll('.identity, nav a, .eyebrow, h1, h2, h3, .personal-description p, .rail span, .tags, .project p, .short-url, .link-list a > span:first-child, footer > span, footer a');

  let samples = [];
  let displayed = 0;
  let animationFrame = 0;
  let animationStart = 0;
  let animationFrom = 0;
  let initialized = false;

  const paint = () => {
    line.style.strokeDashoffset = length * (1 - displayed);
    line.style.visibility = displayed > 0 ? 'visible' : 'hidden';
  };

  const animate = now => {
    const t = Math.min(1, (now - animationStart) / 120);
    displayed = animationFrom + (progress - animationFrom) * t;
    paint();
    animationFrame = t < 1 ? requestAnimationFrame(animate) : 0;
  };

  const draw = () => {
    scrollFrame = 0;
    let next = 0;
    if (motion.matches || maxScroll <= 0 || scrollY >= maxScroll - 2) next = 1;
    else {
      const edge = Math.max(initialEdge,
        scrollY > 0 ? innerHeight * .8 + scrollY - pageTop : initialEdge);
      // Find how far along the path the viewport reaches, regardless of
      // how much horizontal distance each curve contains.
      let index = samples.findIndex(point => point.y > edge);
      if (index < 0) next = 1;
      else if (index > 0) {
        const before = samples[index - 1];
        const after = samples[index];
        const fraction = Math.max(0, Math.min(1, (edge - before.y) / (after.y - before.y)));
        next = (index - 1 + fraction) / (samples.length - 1);
      }
    }
    if (next > progress) {
      progress = next;
      animationFrom = displayed;
      animationStart = performance.now();
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(animate);
    }
    if (motion.matches || !initialized) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      displayed = progress;
    }
    initialized = true;
    paint();
  };

  const scheduleDraw = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(draw);
  };

  const update = () => {
    scheduled = 0;
    const bounds = page.getBoundingClientRect();
    const width = bounds.width;
    const height = bounds.height;
    const headingBounds = heading.getBoundingClientRect();
    pageTop = bounds.top + scrollY;
    initialEdge = headingBounds.top - bounds.top + headingBounds.height * .6 + 16;
    maxScroll = document.documentElement.scrollHeight - innerHeight;

    // Read text layout before changing SVG geometry to avoid forced layouts
    // between DOM writes and text measurements.
    const zones = document.createDocumentFragment();
    const styles = new Map();
    for (const element of textElements) {
      const textNodes = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let node;
      while ((node = textNodes.nextNode())) {
        if (!node.textContent.trim()) continue;
        const parent = node.parentElement;
        let font = styles.get(parent);
        if (!font) {
          const style = getComputedStyle(parent);
          font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
          styles.set(parent, font);
        }
        let metrics;
        if (measure) {
          measure.font = font;
          metrics = measure.measureText(node.textContent);
        }
        const topInset = metrics ? Math.max(0, (metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent) - metrics.actualBoundingBoxAscent) : 0;
        const bottomInset = metrics ? Math.max(0, (metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent) - metrics.actualBoundingBoxDescent) : 0;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (!r.width || !r.height) continue;
          const rect = document.createElementNS(ns, 'rect');
          rect.setAttribute('x', r.left - bounds.left - 4);
          rect.setAttribute('y', r.top - bounds.top + topInset - 3);
          rect.setAttribute('width', r.width + 8);
          rect.setAttribute('height', Math.max(1, r.height - topInset - bottomInset) + 6);
          rect.setAttribute('rx', 3);
          zones.append(rect);
        }
      }
    }
    // Fit the route to page height without distorting its curves.
    const scale = height / 1800;
    const offsetX = 0;
    const offsetY = height * .095;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    // Bake scaling into the coordinates so dash lengths stay in page pixels.
    if (height !== routeHeight) {
      let coordinate = 0;
      line.setAttribute('d', route.replace(/-?\d+(?:\.\d+)?/g, value =>
        Number(value) * scale + (coordinate++ % 2 ? offsetY : offsetX)));
      length = line.getTotalLength();
      samples = Array.from({ length: 513 }, (_, i) => line.getPointAtLength(length * i / 512));
      line.style.strokeDasharray = `${length} ${length}`;
      routeHeight = height;
    }
    const gradient = svg.querySelector('#page-gradient');
    gradient.setAttribute('x1', offsetX);
    gradient.setAttribute('y1', offsetY);
    gradient.setAttribute('x2', offsetX + 1200 * scale);
    gradient.setAttribute('y2', offsetY + height);
    const mask = svg.querySelector('#line-text-fade');
    mask.setAttribute('x', 0);
    mask.setAttribute('y', 0);
    mask.setAttribute('width', width);
    mask.setAttribute('height', height);
    const base = svg.querySelector('.line-mask-base');
    base.setAttribute('width', width);
    base.setAttribute('height', height);

    svg.querySelector('.line-text-zones').replaceChildren(zones);
    draw();
  };

  const schedule = () => {
    if (!scheduled) scheduled = requestAnimationFrame(update);
  };
  new ResizeObserver(schedule).observe(page);
  document.fonts.ready.then(schedule);
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('scroll', scheduleDraw, { passive: true });
  motion.addEventListener('change', scheduleDraw);
  schedule();
})();
