/* ==========================================================
   La Carte — application principale
   - charge et vérifie data/cocktails.json, data/ingredients.json, data/stock.json
   - calcule la disponibilité de chaque cocktail selon le stock
   - affiche la grille, la fiche, la recette et le calcul des doses
   - gère le mode invité / mode hôte (PIN)
   Le formulaire d'ajout/modification est dans editor.js, l'écran Stock dans stock.js.
   ========================================================== */
(() => {
  'use strict';

  /* ---------- Réglages (config.js) ---------- */
  const DEFAULTS = { title: 'La Carte', subtitle: '', hostPin: '1234', github: { owner: '', repo: '', branch: 'main' } };
  const userConfig = window.CARTE_CONFIG || {};
  const CONFIG = { ...DEFAULTS, ...userConfig, github: { ...DEFAULTS.github, ...(userConfig.github || {}) } };

  /* ---------- Stockage local (protégé : peut être indisponible en navigation privée) ---------- */
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* ignoré */ } },
    remove(key) { try { localStorage.removeItem(key); } catch { /* ignoré */ } },
  };
  const KEY_HOST = 'carte.hostMode';

  /* ---------- État de l'application ---------- */
  const state = {
    cocktails: [],     // la liste chargée depuis le JSON
    current: null,     // le cocktail affiché dans la fiche
    view: 'info',      // 'info' (fiche) ou 'recipe' (recette)
    servings: 1,       // nombre de verres pour le calcul des doses
    host: storage.get(KEY_HOST) === '1',
    previews: {},      // images fraîchement envoyées (affichées avant la mise en ligne)
    lastSlug: null,
    ingredients: [],   // liste de référence (data/ingredients.json), triée
    ingMap: new Map(), // id → ingrédient
    stock: null,       // Set des ids en stock (null = stock inconnu : tout est disponible)
    loadWarnings: [],  // problèmes de fichiers (ingredients.json / stock.json)
    warnings: [],      // avertissements affichés en mode hôte
  };

  /** Catégories de l'écran Stock, dans l'ordre d'affichage. */
  const CATEGORIES = [
    ['alcools', 'Alcools'],
    ['sirops', 'Sirops'],
    ['jus-softs', 'Jus et softs'],
    ['frais', 'Frais'],
    ['autres', 'Autres'],
  ];
  const categoryIndex = (cat) => {
    const i = CATEGORIES.findIndex(([id]) => id === cat);
    return i === -1 ? CATEGORIES.length - 1 : i;
  };

  /* ---------- Petits outils ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Crée un élément HTML : h('p', { class: 'x' }, 'texte', autreElement) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value == null || value === false) continue;
        if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key === 'class') el.className = value;
        else if (key === 'style') el.style.cssText = value;
        else el.setAttribute(key, value === true ? '' : value);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : String(child));
    }
    return el;
  }

  /** « Piña Colada » → « pina-colada » (sert de nom de fichier pour l'image) */
  function slugify(text) {
    return String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cocktail';
  }

  const numberFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
  const litersFr = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

  /** 7.5 + « cl » → « 7,5 cl » ; au-delà d'un litre → « 1,2 L » */
  function formatQty(quantity, unit) {
    unit = (unit || '').trim();
    if (quantity === null || quantity === undefined || quantity === '') return unit;
    const value = Number(quantity);
    if (!Number.isFinite(value)) return `${quantity} ${unit}`.trim();
    if (unit === 'cl' && value >= 100) return `${litersFr.format(value / 100)} L`;
    return `${numberFr.format(value)} ${unit}`.trim();
  }

  /* ---------- Images et placeholder ---------- */
  const PLACEHOLDER_COLORS = [
    ['#4a3420', '#120d09'], ['#1f2c47', '#0b0f18'], ['#4a2328', '#140a0c'],
    ['#23402f', '#0a120d'], ['#4b3c1c', '#14100a'], ['#3a2645', '#100b14'],
  ];

  function imageSrc(c) {
    if (state.previews[c.slug]) return state.previews[c.slug];
    const path = c.image || `images/${c.slug}.webp`;
    return c.v ? `${path}?v=${encodeURIComponent(c.v)}` : path;
  }

  /** Bloc image : un placeholder élégant, recouvert par la photo si elle se charge. */
  function media(c, { eager = false, alt, src } = {}) {
    const name = c.name || '?';
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    const [a, b] = PLACEHOLDER_COLORS[hash % PLACEHOLDER_COLORS.length];
    const initial = name.trim().charAt(0).toUpperCase();

    const wrap = h('div', { class: 'media' },
      h('div', { class: 'placeholder', style: `--ph-a:${a};--ph-b:${b}`, 'aria-hidden': 'true' }, h('span', null, initial)));

    const url = src === null ? null : (src || imageSrc(c)); // src: null = pas de photo
    if (url) {
      const img = h('img', { alt: alt ?? `Photo du cocktail ${name}`, loading: eager ? 'eager' : 'lazy', decoding: 'async' });
      img.addEventListener('load', () => img.classList.add('loaded'));
      // image absente → on garde le placeholder, sans icône d'image cassée
      img.addEventListener('error', () => img.remove());
      img.src = url;
      wrap.append(img);
    }
    return wrap;
  }

  /* ---------- Lecture et vérification du JSON ---------- */
  function describeJsonError(err, text, path = 'data/cocktails.json') {
    const msg = String(err && err.message || err);
    let line = null, col = null;
    const lc = msg.match(/line (\d+) column (\d+)/i);
    const pos = msg.match(/position (\d+)/i);
    if (lc) { line = +lc[1]; col = +lc[2]; }
    else if (pos) {
      const before = text.slice(0, +pos[1]).split('\n');
      line = before.length; col = before[before.length - 1].length + 1;
    }
    const where = line ? ` vers la ligne ${line}, colonne ${col}` : '';
    return `Le fichier ${path} est mal écrit${where}. Vérifie les virgules (pas de virgule après le dernier élément d'une liste), les guillemets droits "…" et les accolades { }.`;
  }

  /**
   * Transforme le texte du JSON en liste de cocktails.
   * Renvoie { cocktails, errors } — errors est vide si tout va bien.
   */
  function parseCocktails(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (err) { return { cocktails: [], errors: [describeJsonError(err, text)] }; }

    const errors = [];
    const list = Array.isArray(data) ? data : data && data.cocktails;
    if (!Array.isArray(list)) {
      return { cocktails: [], errors: ['Le fichier doit avoir la forme { "cocktails": [ … ] }.'] };
    }

    const seen = new Set();
    list.forEach((c, i) => {
      const label = `Cocktail n°${i + 1}${c && typeof c.name === 'string' && c.name ? ` (« ${c.name} »)` : ''}`;
      if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(`${label} : ce n'est pas un bloc { … }.`); return; }
      if (typeof c.name !== 'string' || !c.name.trim()) errors.push(`${label} : le nom (« name ») est manquant.`);
      if (!Array.isArray(c.ingredients)) errors.push(`${label} : « ingredients » doit être une liste [ … ].`);
      else c.ingredients.forEach((ing, j) => {
        // nouveau format : « id » (renvoie à data/ingredients.json) ; ancien format toléré : « name »
        const hasId = ing && typeof ing.id === 'string' && ing.id.trim();
        const hasName = ing && typeof ing.name === 'string' && ing.name.trim();
        if (!hasId && !hasName) { errors.push(`${label} : l'ingrédient n°${j + 1} n'a pas d'identifiant (« id »).`); return; }
        const what = ing.label || ing.id || ing.name;
        if (ing.quantity != null && ing.quantity !== '' && !Number.isFinite(Number(ing.quantity))) {
          errors.push(`${label} : la quantité de « ${what} » n'est pas un nombre (écris 7.5 avec un point, sans guillemets).`);
        }
        if (ing.optionnel != null && typeof ing.optionnel !== 'boolean') {
          errors.push(`${label} : « optionnel » de « ${what} » doit valoir true ou false (sans guillemets).`);
        }
        if (ing.label != null && typeof ing.label !== 'string') errors.push(`${label} : « label » de « ${what} » doit être un texte.`);
      });
      if (c.steps != null && !Array.isArray(c.steps)) errors.push(`${label} : « steps » doit être une liste [ … ].`);
      for (const key of ['slug', 'description', 'glass', 'ice', 'technique', 'garnish', 'image']) {
        if (c[key] != null && typeof c[key] !== 'string') errors.push(`${label} : « ${key} » doit être un texte entre guillemets.`);
      }
      const slug = c.slug || slugify(c.name);
      if (seen.has(slug)) errors.push(`${label} : l'identifiant « ${slug} » existe déjà (deux cocktails portent le même nom ?).`);
      seen.add(slug);
    });
    if (errors.length) return { cocktails: [], errors };

    const cocktails = list.map((c) => ({
      ...c,
      slug: c.slug || slugify(c.name),
      ingredients: c.ingredients,
      steps: c.steps || [],
    }));
    return { cocktails, errors: [], data };
  }

  /** data/ingredients.json → { ingredients, errors } */
  function parseIngredients(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (err) { return { ingredients: [], errors: [describeJsonError(err, text, 'data/ingredients.json')] }; }
    const list = Array.isArray(data) ? data : data && data.ingredients;
    if (!Array.isArray(list)) return { ingredients: [], errors: ['data/ingredients.json doit avoir la forme { "ingredients": [ … ] }.'] };
    const errors = [];
    const seen = new Set();
    const ingredients = [];
    list.forEach((ing, i) => {
      if (!ing || typeof ing.id !== 'string' || !ing.id.trim() || typeof ing.nom !== 'string' || !ing.nom.trim()) {
        errors.push(`data/ingredients.json : l'ingrédient n°${i + 1} doit avoir un « id » et un « nom ».`);
        return;
      }
      if (seen.has(ing.id)) { errors.push(`data/ingredients.json : l'id « ${ing.id} » est en double.`); return; }
      seen.add(ing.id);
      ingredients.push({ id: ing.id, nom: ing.nom, categorie: ing.categorie || 'autres' });
    });
    return { ingredients: sortIngredients(ingredients), errors };
  }

  /** data/stock.json → { stock: [ids], errors } */
  function parseStock(text) {
    let data;
    try { data = JSON.parse(text); }
    catch (err) { return { stock: null, errors: [describeJsonError(err, text, 'data/stock.json')] }; }
    const list = Array.isArray(data) ? data : data && data.stock;
    if (!Array.isArray(list)) return { stock: null, errors: ['data/stock.json doit avoir la forme { "stock": [ … ] }.'] };
    return { stock: list.filter((id) => typeof id === 'string'), errors: [] };
  }

  function sortIngredients(list) {
    return [...list].sort((a, b) => categoryIndex(a.categorie) - categoryIndex(b.categorie) || a.nom.localeCompare(b.nom, 'fr'));
  }

  /** Nom affiché d'un ingrédient de recette (« label » > nom de référence > ancien « name » > id). */
  function ingredientName(ing) {
    return ing.label || (state.ingMap.get(ing.id) || {}).nom || ing.name || ing.id || '?';
  }

  const lowerFirst = (s) => (s ? s.charAt(0).toLocaleLowerCase('fr') + s.slice(1) : s);

  /**
   * Disponibilité d'un cocktail : tous ses ingrédients NON optionnels doivent être en stock.
   * stock : Set d'ids (null = stock inconnu → toujours disponible).
   */
  function availability(c, stock = state.stock) {
    if (!stock) return { available: true, missing: [] };
    const missing = [];
    const seen = new Set();
    for (const ing of c.ingredients) {
      if (ing.optionnel || !ing.id) continue; // ancien format sans id : non évaluable (avertissement à part)
      if (stock.has(ing.id) || seen.has(ing.id)) continue;
      seen.add(ing.id);
      missing.push(lowerFirst((state.ingMap.get(ing.id) || {}).nom || ing.label || ing.id));
    }
    return { available: missing.length === 0, missing };
  }

  /** Avertissements lisibles (ids inconnus, fichiers manquants), affichés en mode hôte. */
  function computeWarnings() {
    const out = [...state.loadWarnings];
    for (const c of state.cocktails) {
      for (const ing of c.ingredients) {
        if (!ing.id) out.push(`« ${c.name} » : l'ingrédient « ${ing.name} » n'est pas relié à la liste des ingrédients (champ « id » manquant). Modifie le cocktail pour le choisir dans la liste.`);
        else if (state.ingredients.length && !state.ingMap.has(ing.id)) out.push(`« ${c.name} » : ingrédient inconnu « ${ing.id} » (absent de data/ingredients.json).`);
      }
    }
    if (state.stock && state.ingredients.length) {
      for (const id of state.stock) if (!state.ingMap.has(id)) out.push(`data/stock.json : ingrédient inconnu « ${id} ».`);
    }
    state.warnings = [...new Set(out)];
  }

  /** JSON lisible : objets simples (ingrédients) sur une seule ligne. */
  function prettyJson(value) {
    return `${JSON.stringify(value, null, 2)
      .replace(/\{\n\s+([^{}[\]]*?)\n\s*\}/g, (_, inner) => `{ ${inner.split(/,\n\s*/).join(', ')} }`)}\n`;
  }

  /* ---------- Affichage de la grille ---------- */
  const grid = $('#grid');
  const status = $('#status');

  function showError(title, lines) {
    grid.replaceChildren();
    status.replaceChildren(h('div', { class: 'error-box', role: 'alert' },
      h('h2', null, title),
      h('ul', null, lines.map((l) => h('li', null, l))),
      h('p', null, 'Corrige le fichier puis recharge la page.')));
  }

  const SOLD_OUT = 'Victime de son succès';
  const soldOutBanner = () => h('div', { class: 'sold-out', 'aria-hidden': 'true' }, h('span', null, SOLD_OUT));

  function renderGrid() {
    status.replaceChildren();
    renderWarnings();
    if (!state.cocktails.length) {
      status.textContent = state.host ? 'La carte est vide : touche « + Ajouter » pour créer un premier cocktail.' : 'La carte est vide pour le moment.';
    }
    // les cocktails disponibles d'abord, les indisponibles en fin de grille (ordre du fichier conservé)
    const items = state.cocktails.map((c) => ({ c, av: availability(c) }));
    items.sort((a, b) => Number(!a.av.available) - Number(!b.av.available));

    grid.replaceChildren(...items.map(({ c, av }, i) => {
      const out = !av.available;
      const showMissing = out && state.host;
      let label = `${c.name}${out ? `, ${SOLD_OUT.toLowerCase()}` : ''}`;
      if (showMissing) label += ` (manque : ${av.missing.join(', ')})`;
      return h('li', null,
        h('button', {
          type: 'button', class: `card${out ? ' is-out' : ''}`, style: `--i:${i}`, 'data-slug': c.slug,
          'aria-haspopup': 'dialog', 'aria-label': `${label} — voir la fiche`,
          onclick: () => openCocktail(c.slug),
        },
        media(c, { alt: '' }),
        out ? soldOutBanner() : null,
        h('span', { class: 'card-name', 'aria-hidden': 'true' }, c.name,
          showMissing ? h('small', { class: 'card-missing' }, `Manque : ${av.missing.join(', ')}`) : null)));
    }));
  }

  /** Encadré d'avertissements, visible uniquement en mode hôte. */
  function renderWarnings() {
    const box = $('#host-warnings');
    if (!box) return;
    const show = state.host && state.warnings.length > 0;
    box.hidden = !show;
    if (!show) { box.replaceChildren(); return; }
    box.replaceChildren(
      h('p', { class: 'warn-title' }, 'À vérifier (visible seulement en mode hôte)'),
      h('ul', null, state.warnings.map((w) => h('li', null, w))));
  }

  async function fetchText(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`erreur ${res.status}`);
    return res.text();
  }

  /** Applique ingrédients + stock lus dans les fichiers (sans jamais bloquer la carte). */
  function applyIngredients(list) {
    state.ingredients = sortIngredients(list);
    state.ingMap = new Map(state.ingredients.map((i) => [i.id, i]));
  }

  async function loadData() {
    const [cocktailsRes, ingredientsRes, stockRes] = await Promise.allSettled(
      ['data/cocktails.json', 'data/ingredients.json', 'data/stock.json'].map(fetchText));

    if (cocktailsRes.status === 'rejected') {
      showError('Impossible de charger la carte', [location.protocol === 'file:'
        ? 'Le site est ouvert directement depuis le disque (adresse « file:// »). Lance le petit serveur local décrit dans le README.'
        : `Le fichier data/cocktails.json est introuvable ou inaccessible (${cocktailsRes.reason.message}).`]);
      return;
    }
    const result = parseCocktails(cocktailsRes.value);
    if (result.errors.length) { showError('La carte contient une erreur', result.errors); return; }

    // ingrédients et stock : en cas de problème, on avertit l'hôte mais la carte s'affiche quand même
    state.loadWarnings = [];
    if (ingredientsRes.status === 'fulfilled') {
      const ing = parseIngredients(ingredientsRes.value);
      state.loadWarnings.push(...ing.errors);
      applyIngredients(ing.ingredients);
    } else {
      state.loadWarnings.push(`data/ingredients.json est introuvable (${ingredientsRes.reason.message}) : les noms d'ingrédients risquent de s'afficher sous forme d'identifiants.`);
    }
    if (stockRes.status === 'fulfilled') {
      const st = parseStock(stockRes.value);
      state.loadWarnings.push(...st.errors);
      state.stock = st.stock ? new Set(st.stock) : null;
    } else {
      state.loadWarnings.push(`data/stock.json est introuvable (${stockRes.reason.message}) : tous les cocktails sont affichés comme disponibles.`);
    }
    if (!state.stock && stockRes.status === 'fulfilled') state.loadWarnings.push('Le stock est illisible : tous les cocktails sont affichés comme disponibles.');

    state.cocktails = result.cocktails;
    state.loaded = true;
    computeWarnings();
    renderGrid();
    openFromHash();
  }

  /* ---------- Fiche cocktail ---------- */
  const sheet = $('#sheet');
  const panel = $('.sheet-panel', sheet);
  const scroller = $('#sheet-scroll');
  const sheetMedia = $('#sheet-media');
  const sheetBody = $('#sheet-body');
  let lastFocus = null;
  let ignoreNextPop = false;
  let dragClosed = false;

  const findCocktail = (slug) => state.cocktails.find((c) => c.slug === slug);

  function openCocktail(slug, { push = true } = {}) {
    const c = findCocktail(slug);
    if (!c) return;
    state.current = c;
    state.lastSlug = slug;
    state.view = 'info';
    state.servings = 1;
    renderSheet();
    if (!sheet.open) {
      lastFocus = document.activeElement;
      sheet.classList.remove('closing');
      panel.style.cssText = '';
      sheet.showModal();
      document.documentElement.classList.add('no-scroll');
    }
    scroller.scrollTop = 0;
    sheetBody.scrollTop = 0;
    // une entrée d'historique : le bouton « retour » du téléphone ferme la fiche
    if (push && !(history.state && history.state.sheet === slug)) {
      history.pushState({ sheet: slug }, '', `#${encodeURIComponent(slug)}`);
    }
  }

  function renderSheet() {
    const c = state.current;
    if (!c) return;
    const av = availability(c);
    sheetMedia.replaceChildren(media(c, { eager: true, alt: `Photo du cocktail ${c.name}` }));
    sheetMedia.classList.toggle('is-out', !av.available);
    if (!av.available) sheetMedia.append(soldOutBanner());

    const parts = [h('h2', { id: 'sheet-title', class: 'cocktail-name' }, c.name)];
    if (!av.available) parts.push(h('p', { class: 'sr-only' }, `${SOLD_OUT} : ce cocktail n'est pas disponible pour le moment.`));
    if (c.description) parts.push(h('p', { class: 'cocktail-desc' }, c.description));
    if (!av.available && state.host) parts.push(h('p', { class: 'missing-note' }, `Manque : ${av.missing.join(', ')}`));

    if (state.view === 'recipe' && state.host) {
      parts.push(renderRecipe(c));
    } else {
      parts.push(
        h('h3', { class: 'section-title' }, 'Ingrédients'),
        h('ul', { class: 'chips' }, c.ingredients.map((ing) => h('li', { class: ing.optionnel ? 'is-optional' : null },
          ingredientName(ing), ing.optionnel ? h('small', null, ' · facultatif') : null))));
    }

    if (state.host) {
      const isRecipe = state.view === 'recipe';
      parts.push(h('div', { class: 'sheet-actions' },
        h('button', { type: 'button', class: 'btn btn-gold', 'data-recipe-toggle': true, 'aria-expanded': String(isRecipe), onclick: toggleRecipe },
          isRecipe ? 'Masquer la recette' : 'Recette'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => window.Carte.onEdit && window.Carte.onEdit(c) }, 'Modifier')));
    }
    sheetBody.replaceChildren(...parts);
  }

  function toggleRecipe() {
    state.view = state.view === 'recipe' ? 'info' : 'recipe';
    renderSheet();
    $('[data-recipe-toggle]', sheetBody)?.focus({ preventScroll: true });
    if (state.view === 'recipe') {
      $('.recipe', sheetBody)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  /* ---------- Vue Recette + calcul des doses ---------- */
  const SERVING_PRESETS = [1, 2, 4, 6, 8];

  function renderRecipe(c) {
    const facts = [['Verre', c.glass], ['Glace', c.ice], ['Technique', c.technique], ['Garniture', c.garnish]]
      .filter(([, v]) => v && String(v).trim());

    return h('section', { class: 'recipe', 'aria-label': 'Recette' },
      h('h3', { class: 'section-title' }, 'Recette'),

      h('div', { class: 'servings' },
        h('p', { class: 'servings-label', id: 'servings-label' }, 'Nombre de verres'),
        h('div', { class: 'servings-presets', role: 'group', 'aria-labelledby': 'servings-label' },
          SERVING_PRESETS.map((n) => h('button', {
            type: 'button', 'data-n': n, 'aria-pressed': String(n === state.servings),
            'aria-label': `${n} verre${n > 1 ? 's' : ''}`, onclick: () => setServings(n),
          }, String(n)))),
        h('div', { class: 'servings-stepper' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Un verre de moins', onclick: () => setServings(state.servings - 1) }, '−'),
          h('output', { class: 'servings-count', 'aria-live': 'polite' }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Un verre de plus', onclick: () => setServings(state.servings + 1) }, '+'))),

      h('h3', { class: 'section-title' }, 'Ingrédients'),
      h('ul', { class: 'qty-list' }, c.ingredients.map((ing, i) => {
        const missing = state.stock && ing.id && !state.stock.has(ing.id);
        return h('li', { class: missing ? 'is-missing' : null },
          h('span', { class: 'qty', 'data-i': i }),
          h('span', { class: 'qty-name' }, ingredientName(ing),
            ing.optionnel ? h('small', { class: 'tag' }, 'facultatif') : null,
            missing ? h('small', { class: 'tag tag-missing' }, 'pas en stock') : null));
      })),

      facts.length ? [
        h('h3', { class: 'section-title' }, 'Service'),
        h('dl', { class: 'facts' }, facts.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
      ] : null,

      c.steps.length ? [
        h('h3', { class: 'section-title' }, 'Étapes'),
        h('ol', { class: 'steps' }, c.steps.map((s) => h('li', null, s))),
      ] : null,
    );
  }

  function setServings(n) {
    state.servings = Math.min(99, Math.max(1, Math.round(n)));
    updateQuantities(true);
  }

  /** Recalcule toutes les quantités selon le nombre de verres. */
  function updateQuantities(animate) {
    const c = state.current;
    if (!c) return;
    const n = state.servings;
    sheetBody.querySelectorAll('.servings-presets button').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.n) === n)));
    const count = $('.servings-count', sheetBody);
    if (count) count.replaceChildren(String(n), h('small', null, n > 1 ? 'verres' : 'verre'));
    sheetBody.querySelectorAll('.qty').forEach((el) => {
      const ing = c.ingredients[Number(el.dataset.i)];
      const q = ing.quantity === '' || ing.quantity == null ? null : Number(ing.quantity) * n;
      el.textContent = formatQty(q, ing.unit);
      if (animate) { el.classList.remove('updated'); void el.offsetWidth; el.classList.add('updated'); }
    });
  }

  // après chaque rendu de la recette, on remplit les quantités
  const recipeObserver = new MutationObserver(() => { if ($('.recipe', sheetBody)) updateQuantities(false); });
  recipeObserver.observe(sheetBody, { childList: true });

  /* ---------- Fermeture de la fiche (bouton, Échap, fond, retour, glisser vers le bas) ---------- */
  function requestClose() {
    if (history.state && history.state.sheet) history.back(); // → popstate → hideSheet()
    else hideSheet();
  }

  function hideSheet() {
    if (!sheet.open || sheet.classList.contains('closing')) return;
    if (dragClosed || reducedMotion()) { sheet.close(); return; }
    sheet.classList.add('closing');
    setTimeout(() => sheet.close(), 300);
  }

  sheet.addEventListener('close', () => {
    sheet.classList.remove('closing');
    panel.style.cssText = '';
    dragClosed = false;
    state.current = null;
    document.documentElement.classList.remove('no-scroll');
    if (history.state && history.state.sheet) { ignoreNextPop = true; history.back(); }
    else if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    const target = (lastFocus && lastFocus !== document.body && document.contains(lastFocus)) ? lastFocus
      : grid.querySelector(`[data-slug="${CSS.escape(state.lastSlug || '')}"]`);
    target?.focus({ preventScroll: true });
  });

  sheet.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); }); // touche Échap
  sheet.addEventListener('click', (e) => { if (e.target === sheet) requestClose(); }); // clic sur le fond
  $('#sheet-close').addEventListener('click', requestClose);

  window.addEventListener('popstate', () => {
    if (ignoreNextPop) { ignoreNextPop = false; return; }
    const slug = history.state && history.state.sheet;
    if (slug && findCocktail(slug)) openCocktail(slug, { push: false });
    else if (location.hash.length > 1 && findCocktail(decodeURIComponent(location.hash.slice(1)))) openFromHash(); // lien #slug
    else hideSheet();
  });

  function openFromHash() {
    const slug = decodeURIComponent(location.hash.slice(1));
    if (!slug || !findCocktail(slug)) return;
    history.replaceState(null, '', location.pathname + location.search);
    openCocktail(slug);
  }

  // glisser la fiche vers le bas pour la fermer (mobile)
  let drag = null;
  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || window.matchMedia('(min-width: 820px)').matches) return;
    if (scroller.scrollTop > 0) return;
    drag = { y0: e.touches[0].clientY, t0: performance.now(), dy: 0, active: false };
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const dy = e.touches[0].clientY - drag.y0;
    if (!drag.active) {
      if (dy > 6 && scroller.scrollTop <= 0) { drag.active = true; panel.style.animation = 'none'; }
      else if (dy < -6) { drag = null; return; }
      else return;
    }
    if (e.cancelable) e.preventDefault();
    drag.dy = Math.max(0, dy);
    panel.style.transform = `translateY(${drag.dy}px)`;
  }, { passive: false });

  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) return;
    const speed = d.dy / Math.max(1, performance.now() - d.t0);
    if (d.dy > 120 || (d.dy > 40 && speed > 0.7)) {
      panel.style.transition = 'transform 0.25s ease-in';
      panel.style.transform = 'translateY(105%)';
      dragClosed = true;
      setTimeout(requestClose, 230);
    } else {
      panel.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
      panel.style.transform = '';
      setTimeout(() => { panel.style.cssText = ''; }, 320);
    }
  }
  panel.addEventListener('touchend', endDrag);
  panel.addEventListener('touchcancel', endDrag);

  /* ---------- Messages (toasts) ---------- */
  const toasts = $('#toasts');
  function toast(message, type = 'info', duration = 4500) {
    const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
    toasts.append(el);
    // repasse la zone des messages au premier plan (au-dessus d'une fenêtre ouverte)
    if (toasts.showPopover) { try { if (toasts.matches(':popover-open')) toasts.hidePopover(); toasts.showPopover(); } catch { /* ignoré */ } }
    const remove = () => {
      el.classList.add('leaving');
      setTimeout(() => {
        el.remove();
        if (!toasts.children.length && toasts.hidePopover) { try { toasts.hidePopover(); } catch { /* ignoré */ } }
      }, 300);
    };
    if (duration) setTimeout(remove, duration);
    el.addEventListener('click', remove);
    return el;
  }

  /* ---------- Mode hôte ---------- */
  const title = $('#site-title');
  const hostBar = $('#host-bar');
  const pinDialog = $('#pin-dialog');
  const pinForm = $('#pin-form');
  const pinInput = $('#pin-input');
  const pinError = $('#pin-error');

  function setHost(on) {
    state.host = on;
    if (on) storage.set(KEY_HOST, '1'); else storage.remove(KEY_HOST);
    document.body.classList.toggle('is-host', on);
    hostBar.hidden = !on;
    if (!on) state.view = 'info';
    if (state.current) renderSheet();
    // la grille change en mode hôte (ingrédients manquants, avertissements)
    if (state.loaded && !status.querySelector('.error-box')) renderGrid();
  }

  // appui long de 2 secondes sur le titre
  let pressTimer = null;
  let pressOrigin = null;
  function cancelPress() {
    clearTimeout(pressTimer);
    pressTimer = null;
    pressOrigin = null;
    title.classList.remove('pressing');
  }
  title.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pressOrigin = { x: e.clientX, y: e.clientY };
    title.classList.add('pressing');
    pressTimer = setTimeout(() => {
      cancelPress();
      if (navigator.vibrate) navigator.vibrate(30);
      if (state.host) toast('Le mode hôte est déjà actif.');
      else openPin();
    }, 2000);
  });
  title.addEventListener('pointermove', (e) => {
    if (pressOrigin && Math.hypot(e.clientX - pressOrigin.x, e.clientY - pressOrigin.y) > 12) cancelPress();
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => title.addEventListener(ev, cancelPress));
  title.addEventListener('contextmenu', (e) => e.preventDefault());

  function openPin() {
    pinInput.value = '';
    pinError.textContent = '';
    pinDialog.showModal();
    pinInput.focus();
  }

  function checkPin() {
    if (pinInput.value === String(CONFIG.hostPin)) {
      pinDialog.close();
      setHost(true);
      toast('Mode hôte activé : les recettes sont visibles sur cet appareil.', 'success');
      return;
    }
    pinError.textContent = pinInput.value.length < 4 ? 'Le code comporte 4 chiffres.' : 'Code incorrect.';
    pinInput.value = '';
    pinForm.classList.remove('shake');
    void pinForm.offsetWidth;
    pinForm.classList.add('shake');
    pinInput.focus();
  }

  pinInput.addEventListener('input', () => {
    pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
    pinError.textContent = '';
    if (pinInput.value.length === 4) checkPin();
  });
  pinForm.addEventListener('submit', (e) => { e.preventDefault(); checkPin(); });

  // tous les boutons « Annuler » des fenêtres
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-close]');
    if (btn) btn.closest('dialog')?.close();
  });

  $('#host-exit').addEventListener('click', () => {
    setHost(false);
    toast('Mode invité : les recettes sont de nouveau masquées.');
  });
  $('#host-add').addEventListener('click', () => window.Carte.onAdd && window.Carte.onAdd());
  $('#host-github').addEventListener('click', () => window.Carte.onSettings && window.Carte.onSettings());
  $('#host-stock').addEventListener('click', () => window.Carte.onStock && window.Carte.onStock());

  /* ---------- Démarrage ---------- */
  document.title = CONFIG.title;
  title.textContent = CONFIG.title;
  $('#site-subtitle').textContent = CONFIG.subtitle;
  $('#site-subtitle').hidden = !CONFIG.subtitle;
  setHost(state.host);

  /* ---------- Ce que editor.js et stock.js peuvent utiliser ---------- */
  /** Remplace cocktails / ingrédients / stock (après un enregistrement) et rafraîchit l'affichage. */
  function setData({ cocktails, ingredients, stock } = {}) {
    if (cocktails) state.cocktails = cocktails;
    if (ingredients) applyIngredients(ingredients);
    if (stock) state.stock = new Set(stock);
    state.loadWarnings = [];
    computeWarnings();
    renderGrid();
    if (state.current) {
      const fresh = findCocktail(state.current.slug);
      if (fresh) { state.current = fresh; renderSheet(); } else requestClose();
    }
  }

  window.Carte = {
    CONFIG, CATEGORIES, state, storage, h, $, slugify, formatQty, media, imageSrc, toast,
    parseCocktails, parseIngredients, parseStock, sortIngredients, ingredientName, availability, prettyJson,
    openCocktail, setData,
    setCocktails: (cocktails) => setData({ cocktails }),
    closeSheet: requestClose,
    onEdit: null, onAdd: null, onSettings: null, // définis dans editor.js
    onStock: null,                               // défini dans stock.js
  };

  loadData();
})();
