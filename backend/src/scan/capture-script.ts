/*
 * Runs inside the scanned page. Kept as plain JavaScript in a string: bundlers wrap
 * TypeScript functions in helpers that do not exist in the page, and evaluate() would fail.
 */
export const CAPTURE_SCRIPT = String.raw`(() => {
  const MAX_TEXT = 15000;
  const LOGO_WORD = /logo|brand|site-title|navbar-brand/i;
  const abs = (value) => {
    try { return value ? new URL(value, location.href).href : undefined; } catch (error) { return undefined; }
  };
  const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const rgb = (value) => {
    const match = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(value || '');
    if (!match || (match[4] !== undefined && Number(match[4]) < 0.5)) { return undefined; }
    return '#' + [match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('');
  };
  const header = document.querySelector('header, [role=banner], #header, .header, .site-header') || document.querySelector('nav');
  const home = new URL('/', location.href).href;
  const linksHome = (element) => {
    const link = element.closest('a');
    if (!link) { return false; }
    const target = abs(link.getAttribute('href'));
    return target === home || target === location.origin || target === location.href.split('#')[0] || link.getAttribute('href') === '/' || link.getAttribute('href') === './' || link.getAttribute('href') === 'index.html';
  };
  const describe = (element) => [element.getAttribute('alt'), element.getAttribute('class'), element.id, element.getAttribute('aria-label'), element.parentElement && element.parentElement.getAttribute('class'), element.closest('a') && element.closest('a').getAttribute('class')].filter(Boolean).join(' ');
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top + scrollY), left: Math.round(rect.left + scrollX) };
  };
  const logoCandidates = [];
  for (const image of Array.from(document.querySelectorAll('img')).slice(0, 300)) {
    const hint = describe(image) + ' ' + (image.getAttribute('src') || '');
    const inHeader = Boolean(header && header.contains(image));
    const candidate = { kind: 'img', src: abs(image.currentSrc || image.getAttribute('src')), alt: image.getAttribute('alt') || '', hint: hint.slice(0, 300), ...box(image), inHeader, linksHome: linksHome(image), hasLogoWord: LOGO_WORD.test(hint) };
    if (candidate.src && (candidate.hasLogoWord || (inHeader && candidate.linksHome) || (candidate.top < 150 && candidate.linksHome))) { logoCandidates.push(candidate); }
  }
  for (const svg of Array.from(document.querySelectorAll('svg')).slice(0, 200)) {
    const hint = describe(svg);
    const inHeader = Boolean(header && header.contains(svg));
    const size = box(svg);
    if (size.width < 24 || size.height < 12) { continue; }
    const candidate = { kind: 'svg-inline', ...size, hint: hint.slice(0, 300), inHeader, linksHome: linksHome(svg), hasLogoWord: LOGO_WORD.test(hint) };
    if (candidate.hasLogoWord || (inHeader && candidate.linksHome)) {
      const copy = svg.cloneNode(true);
      if (!copy.getAttribute('width')) { copy.setAttribute('width', String(size.width)); }
      if (!copy.getAttribute('height')) { copy.setAttribute('height', String(size.height)); }
      const markup = new XMLSerializer().serializeToString(copy);
      if (markup.length < 200000) { logoCandidates.push({ ...candidate, markup }); }
    }
  }
  let textLogo;
  for (const element of Array.from(document.querySelectorAll('[class*=logo], [id*=logo], [class*=brand]')).slice(0, 50)) {
    const background = getComputedStyle(element).backgroundImage;
    const match = /url\(["']?([^"')]+)["']?\)/.exec(background || '');
    const size = box(element);
    if (match) {
      logoCandidates.push({ kind: 'css', src: abs(match[1]), hint: describe(element).slice(0, 300), ...size, inHeader: Boolean(header && header.contains(element)), linksHome: linksHome(element), hasLogoWord: true });
    } else if (!textLogo && !element.querySelector('img, svg') && clean(element.textContent).length > 1 && clean(element.textContent).length < 60) {
      textLogo = clean(element.textContent);
    }
  }
  for (const link of Array.from(document.querySelectorAll('link[rel~=icon], link[rel=apple-touch-icon], link[rel=apple-touch-icon-precomposed]'))) {
    const sizes = (link.getAttribute('sizes') || '').split('x');
    logoCandidates.push({ kind: 'icon', src: abs(link.getAttribute('href')), hint: link.getAttribute('rel') || '', width: Number(sizes[0]) || 0, height: Number(sizes[1]) || 0, top: 0, left: 0, inHeader: false, linksHome: false, hasLogoWord: false });
  }
  const meta = {};
  for (const element of Array.from(document.querySelectorAll('meta[property^="og:"], meta[name^="og:"], meta[name^="twitter:"], meta[name=description], meta[name=theme-color]'))) {
    const key = element.getAttribute('property') || element.getAttribute('name');
    const content = element.getAttribute('content');
    if (key && content) { meta[key] = content.slice(0, 1000); }
  }
  for (const key of ['og:logo', 'og:image']) {
    if (meta[key]) { logoCandidates.push({ kind: 'meta', src: abs(meta[key]), hint: key, width: 0, height: 0, top: 0, left: 0, inHeader: false, linksHome: false, hasLogoWord: key === 'og:logo' }); }
  }
  const colors = [];
  const sample = (role, value, weight) => { const color = rgb(value); if (color) { colors.push({ role, color, weight }); } };
  const buttons = Array.from(document.querySelectorAll('button, input[type=submit], a[class*=btn], a[class*=button], a[class*=cta], .btn, .button, [role=button]')).slice(0, 40);
  for (const button of buttons) {
    const style = getComputedStyle(button);
    const area = Math.min(20000, button.getBoundingClientRect().width * button.getBoundingClientRect().height);
    sample('button-bg', style.backgroundColor, 2 + area / 2000);
    sample('button-text', style.color, 1);
  }
  for (const link of Array.from(document.querySelectorAll('a')).slice(0, 80)) { sample('link', getComputedStyle(link).color, 0.5); }
  for (const element of Array.from(document.querySelectorAll('header, nav, footer, [role=banner]')).slice(0, 6)) {
    const rect = element.getBoundingClientRect();
    sample('header-bg', getComputedStyle(element).backgroundColor, 2 + Math.min(10, (rect.width * rect.height) / 50000));
  }
  for (const heading of Array.from(document.querySelectorAll('h1, h2')).slice(0, 10)) { sample('heading', getComputedStyle(heading).color, 1.5); }
  sample('body-bg', getComputedStyle(document.body).backgroundColor, 5);
  sample('body-bg', getComputedStyle(document.documentElement).backgroundColor, 3);
  sample('body-text', getComputedStyle(document.body).color, 3);
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = [];
    try { rules = Array.from(sheet.cssRules || []); } catch (error) { rules = []; }
    for (const rule of rules.slice(0, 2000)) {
      if (rule.selectorText !== ':root' || !rule.style) { continue; }
      for (const name of Array.from(rule.style)) {
        if (name.startsWith('--') && /color|brand|primary|accent|secondary/i.test(name)) {
          const probe = document.createElement('i');
          probe.style.color = rule.style.getPropertyValue(name).trim();
          document.body.appendChild(probe);
          const weight = /primary|brand/i.test(name) ? 6 : /accent|secondary/i.test(name) ? 4 : 1;
          sample('css-var', getComputedStyle(probe).color, weight);
          probe.remove();
        }
      }
    }
  }
  const fonts = {};
  for (const [role, selector] of [['body', 'body'], ['heading', 'h1, h2'], ['button', 'button, .btn, .button']]) {
    const element = document.querySelector(selector);
    if (element) { fonts[role] = getComputedStyle(element).fontFamily.slice(0, 200); }
  }
  const main = document.querySelector('main') || document.body;
  const ctas = [];
  for (const element of buttons.concat(Array.from(document.querySelectorAll('a')).filter((link) => /btn|button|cta/i.test(link.className)))) {
    const label = clean(element.innerText || element.value);
    if (label && label.length <= 40 && !ctas.includes(label)) { ctas.push(label); }
  }
  const images = [];
  for (const image of Array.from(document.querySelectorAll('img')).slice(0, 300)) {
    const width = image.naturalWidth || image.getBoundingClientRect().width;
    const height = image.naturalHeight || image.getBoundingClientRect().height;
    const src = abs(image.currentSrc || image.getAttribute('src'));
    if (src && width >= 400 && height >= 300 && !images.some((item) => item.src === src)) { images.push({ src, alt: (image.getAttribute('alt') || '').slice(0, 200), width, height }); }
  }
  const navLinks = [];
  for (const link of Array.from(document.querySelectorAll('nav a[href], header a[href], footer a[href], a[href]')).slice(0, 300)) {
    const href = abs(link.getAttribute('href'));
    if (href && href.startsWith(location.origin) && !navLinks.some((item) => item.href === href)) { navLinks.push({ href: href.split('#')[0], text: clean(link.innerText).slice(0, 80) }); }
  }
  return {
    url: location.href,
    title: clean(document.title).slice(0, 300),
    meta,
    jsonLd: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((script) => (script.textContent || '').slice(0, 20000)).slice(0, 10),
    logoCandidates: logoCandidates.slice(0, 40),
    textLogo,
    colors: colors.slice(0, 400),
    fonts,
    headings: Array.from(document.querySelectorAll('h1, h2, h3')).map((element) => clean(element.innerText)).filter(Boolean).slice(0, 40),
    text: clean(main.innerText).slice(0, MAX_TEXT),
    ctas: ctas.slice(0, 30),
    images: images.slice(0, 60),
    navLinks: navLinks.slice(0, 120),
  };
})()`;
