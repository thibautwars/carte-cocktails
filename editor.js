/* ==========================================================
   La Carte — enregistrement sur GitHub + formulaire cocktail (mode hôte)

   Chaque enregistrement crée UN SEUL commit dans le dépôt (API « Git Data ») :
     - la photo va dans images/<slug>.webp
     - la recette va dans data/cocktails.json
     - un ingrédient créé à la volée va dans data/ingredients.json
   GitHub Pages remet ensuite le site en ligne (≈ 1 minute).
   Le token GitHub n'est stocké QUE dans le localStorage de l'appareil.
   ========================================================== */
(() => {
  'use strict';
  const C = window.Carte;
  if (!C) return;
  const { h, $, toast, storage, slugify, media, CONFIG, state } = C;

  const KEY_TOKEN = 'carte.githubToken';
  const API = 'https://api.github.com';
  const PATHS = { cocktails: 'data/cocktails.json', ingredients: 'data/ingredients.json', stock: 'data/stock.json' };
  const MAX_WIDTH = 1200;
  const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new';

  /* ---------- Quel dépôt ? (config.js, sinon deviné depuis l'adresse GitHub Pages) ---------- */
  function getRepo() {
    const g = CONFIG.github || {};
    const branch = g.branch || 'main';
    if (g.owner && g.repo) return { owner: g.owner, repo: g.repo, branch };
    const m = location.hostname.match(/^([a-z0-9-]+)\.github\.io$/i);
    if (!m) return null;
    const first = location.pathname.split('/').filter(Boolean)[0];
    const repo = first && !first.includes('.') ? first : `${m[1]}.github.io`;
    return { owner: m[1], repo, branch };
  }

  /* ---------- Conversion texte / base64 (GitHub échange les fichiers en base64) ---------- */
  function base64ToUtf8(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
  }
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error("Impossible de lire l'image."));
      reader.readAsDataURL(blob);
    });
  }

  /* ---------- Appels à l'API GitHub ---------- */
  function explainStatus(status, detail) {
    switch (status) {
      case 401: return 'Token GitHub refusé : il est invalide ou expiré. Crée-en un nouveau (bouton « GitHub » en bas).';
      case 403: return "Le token n'a pas le droit d'écrire. Vérifie la permission « Contents : Read and write » sur ce dépôt.";
      case 404: return 'Dépôt introuvable. Vérifie que le token donne accès à ce dépôt, et le nom du dépôt dans config.js.';
      case 409: return 'Le dépôt a changé pendant l\'envoi. Réessaie.';
      case 422: return `GitHub a refusé l'envoi${detail ? ` (${detail})` : ''}.`;
      default: return `Erreur GitHub ${status}${detail ? ` : ${detail}` : ''}.`;
    }
  }

  async function gh(path, { method = 'GET', body, token = storage.get(KEY_TOKEN), allow404 = false } = {}) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Connexion à GitHub impossible. Vérifie ta connexion Internet.');
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch { /* pas de détail */ }
      const err = new Error(explainStatus(res.status, detail));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  const repoUrl = (repo) => `/repos/${repo.owner}/${repo.repo}`;
  const contentsUrl = (repo, path) => `${repoUrl(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  /** Lit un fichier du dépôt à une version précise (ref) ; null s'il n'existe pas. */
  const getFile = (repo, path, ref) =>
    gh(`${contentsUrl(repo, path)}?ref=${encodeURIComponent(ref || repo.branch)}`, { allow404: true });

  /**
   * Crée UN commit contenant plusieurs fichiers.
   * build(read) reçoit une fonction read(path) → texte du fichier en ligne (ou null),
   * et renvoie { files: [{ path, text } | { path, base64 } | { path, remove: true }], result }.
   * En cas de modification simultanée, on relit tout et on recommence une fois.
   */
  async function commitChanges(repo, build, message) {
    const base = repoUrl(repo);
    for (let attempt = 0; ; attempt++) {
      const ref = await gh(`${base}/git/ref/heads/${repo.branch}`);
      const headSha = ref.object.sha;
      const head = await gh(`${base}/git/commits/${headSha}`);

      const read = async (path) => {
        const file = await getFile(repo, path, headSha);
        return file ? base64ToUtf8(file.content) : null;
      };
      const { files, result } = await build(read);

      const tree = [];
      for (const f of files) {
        if (f.remove) tree.push({ path: f.path, mode: '100644', type: 'blob', sha: null });
        else if (f.base64) {
          const blob = await gh(`${base}/git/blobs`, { method: 'POST', body: { content: f.base64, encoding: 'base64' } });
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        } else tree.push({ path: f.path, mode: '100644', type: 'blob', content: f.text });
      }
      const newTree = await gh(`${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree } });
      const commit = await gh(`${base}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [headSha] } });
      try {
        await gh(`${base}/git/refs/heads/${repo.branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        return result;
      } catch (err) {
        if (err.status === 422 && attempt === 0) continue; // quelqu'un a enregistré entre-temps : on recommence
        throw err;
      }
    }
  }

  /* ---------- Lecture des JSON en ligne (pour ne jamais écraser une modif faite ailleurs) ---------- */
  async function readRemoteCocktails(read) {
    const text = await read(PATHS.cocktails);
    if (text == null) return [];
    const r = C.parseCocktails(text);
    if (r.errors.length) throw new Error(`Le fichier ${PATHS.cocktails} sur GitHub contient une erreur : ${r.errors[0]}`);
    return r.cocktails;
  }
  async function readRemoteIngredients(read) {
    const text = await read(PATHS.ingredients);
    if (text == null) return [];
    const r = C.parseIngredients(text);
    if (r.errors.length) throw new Error(r.errors[0]);
    return r.ingredients;
  }
  /** Ajoute les nouveaux ingrédients absents de la liste en ligne ; renvoie { list, changed }. */
  function mergeIngredients(remote, additions) {
    const ids = new Set(remote.map((i) => i.id));
    const added = additions.filter((i) => !ids.has(i.id));
    return { list: C.sortIngredients([...remote, ...added]), changed: added.length > 0 };
  }
  const serializeCocktails = (list) => C.prettyJson({ cocktails: list });
  const serializeIngredients = (list) => C.prettyJson({ ingredients: list.map(({ id, nom, categorie }) => ({ id, nom, categorie })) });
  const serializeStock = (ids) => `${JSON.stringify({ stock: [...ids] }, null, 2)}\n`;

  /* ---------- Compression de l'image (dans le navigateur, avant l'envoi) ---------- */
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Ce fichier n'est pas une image lisible.")); };
      img.src = url;
    });
  }
  const canvasToBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  /** Recadre en portrait 4:5 (au centre), réduit à 1200 px de large, convertit en WebP. */
  async function compressImage(file) {
    const img = await loadImage(file);
    const ratio = 4 / 5;
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (sw / sh > ratio) { sw = Math.round(sh * ratio); sx = Math.round((img.naturalWidth - sw) / 2); }
    else { sh = Math.round(sw / ratio); sy = Math.round((img.naturalHeight - sh) / 2); }
    const width = Math.min(MAX_WIDTH, sw);
    const height = Math.round(width / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height);

    let blob = await canvasToBlob(canvas, 'image/webp', 0.82);
    let ext = 'webp';
    // certains Safari ne savent pas produire du WebP : on se rabat sur du JPEG
    if (!blob || blob.type !== 'image/webp') { blob = await canvasToBlob(canvas, 'image/jpeg', 0.85); ext = 'jpg'; }
    if (!blob) throw new Error("La conversion de l'image a échoué.");
    return { blob, ext, width, height };
  }

  const svgClose = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    s.append(p);
    return s;
  };

  /* ==========================================================
     Fenêtre « Connexion GitHub » (token)
     ========================================================== */
  const tokenDialog = $('#token-dialog');
  let afterTokenSaved = null;

  function openSettings({ then } = {}) {
    afterTokenSaved = then || null;
    const repo = getRepo();
    const hasToken = !!storage.get(KEY_TOKEN);
    const input = h('input', {
      id: 'token-input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: hasToken ? 'Token déjà enregistré — laisse vide pour le garder' : 'github_pat_…',
    });
    const statusEl = h('p', { class: 'form-error', 'aria-live': 'polite' });
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-gold' }, 'Tester et enregistrer');

    const form = h('form', { class: 'modal-inner', novalidate: true },
      h('div', { class: 'editor-head' },
        h('h2', { id: 'token-title', class: 'modal-title' }, 'Connexion GitHub'),
        h('button', { type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': 'Fermer' }, svgClose())),
      h('p', { class: 'modal-text' },
        'Pour enregistrer tes cocktails et ton stock, le site a besoin d\'un token GitHub (une clé d\'accès limitée à ton dépôt). ',
        'Tu le saisis une seule fois : il reste uniquement dans ce navigateur. ',
        h('a', { href: TOKEN_HELP_URL, target: '_blank', rel: 'noopener' }, 'Créer un token'), ' (voir le README).'),
      h('p', { class: 'modal-text' }, repo
        ? ['Dépôt : ', h('strong', null, `${repo.owner}/${repo.repo}`), ` (branche ${repo.branch})`]
        : h('span', { style: 'color:var(--danger)' }, 'Dépôt non détecté (normal en local) : renseigne github.owner et github.repo dans config.js.')),
      h('label', { class: 'field' }, h('span', null, 'Token GitHub'), input),
      statusEl,
      h('div', { class: 'modal-actions' },
        hasToken ? h('button', {
          type: 'button', class: 'btn btn-danger btn-small',
          onclick: () => { storage.remove(KEY_TOKEN); tokenDialog.close(); toast('Token supprimé de cet appareil.'); },
        }, 'Oublier le token') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'Annuler'),
        saveBtn));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const token = input.value.trim() || storage.get(KEY_TOKEN);
      if (!token) { statusEl.textContent = 'Colle ton token dans le champ.'; input.focus(); return; }
      saveBtn.disabled = true;
      statusEl.textContent = 'Vérification…';
      try {
        if (repo) await gh(repoUrl(repo), { token });
        storage.set(KEY_TOKEN, token);
        tokenDialog.close();
        toast(repo ? `Connecté à ${repo.owner}/${repo.repo} ✓` : 'Token enregistré sur cet appareil.', 'success');
        const next = afterTokenSaved;
        afterTokenSaved = null;
        if (next) next();
      } catch (err) {
        statusEl.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });

    tokenDialog.replaceChildren(form);
    tokenDialog.showModal();
    input.focus();
  }

  /**
   * Vérifie qu'on peut enregistrer (dépôt connu + token présent).
   * Renvoie le dépôt, ou null (et affiche l'explication / ouvre la saisie du token).
   */
  function ensureReady(showError, retry) {
    const repo = getRepo();
    if (!repo) {
      showError('Dépôt GitHub inconnu. Une fois le site en ligne sur GitHub Pages, il est détecté tout seul ; en local, remplis github.owner et github.repo dans config.js.');
      return null;
    }
    if (!storage.get(KEY_TOKEN)) { openSettings({ then: retry }); return null; }
    return repo;
  }

  /* ==========================================================
     Sélecteur d'ingrédient avec recherche (formulaire cocktail)
     ========================================================== */
  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const categoryLabel = (cat) => (C.CATEGORIES.find(([id]) => id === cat) || [null, 'Autres'])[1];

  let formNewIngredients = new Map(); // ingrédients créés pendant cette saisie (id → { id, nom, categorie })
  const knownIngredients = () => [...state.ingredients, ...formNewIngredients.values()];
  const findIngredient = (id) => state.ingMap.get(id) || formNewIngredients.get(id);
  const findByName = (text) => knownIngredients().find((i) => normalize(i.nom) === normalize(text));

  let comboCount = 0;

  function ingredientPicker(row, initialId, initialText) {
    const listId = `combo-${++comboCount}`;
    const input = h('input', {
      type: 'text', name: 'ing-name', role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false',
      'aria-controls': listId, 'aria-label': 'Ingrédient (rechercher ou créer)', placeholder: 'Rechercher…', autocomplete: 'off',
    });
    const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', hidden: true });
    let options = [];
    let active = -1;

    input.value = initialText;
    row.dataset.id = initialId || '';

    function setId(id) {
      if (row.dataset.id !== id) { // l'étiquette personnalisée ne vaut que pour l'ingrédient d'origine
        delete row.dataset.label;
        row.querySelector('.ing-label-hint')?.remove();
      }
      row.dataset.id = id || '';
      row.classList.remove('is-unknown');
      updateCategory(row);
    }

    function render() {
      const q = normalize(input.value);
      const matches = knownIngredients().filter((i) => !q || normalize(i.nom).includes(q) || i.id.includes(q)).slice(0, 8);
      options = matches.map((i) => ({ type: 'pick', ing: i }));
      if (q && !matches.some((i) => normalize(i.nom) === q)) options.push({ type: 'create', nom: input.value.trim() });
      active = options.length ? 0 : -1;
      list.replaceChildren(...options.map((o, idx) => h('li', {
        role: 'option', id: `${listId}-${idx}`, 'aria-selected': String(idx === active),
        class: o.type === 'create' ? 'combo-create' : null,
        onmousedown: (e) => e.preventDefault(), // garde le focus dans le champ
        onclick: () => choose(idx),
      }, o.type === 'create'
        ? `+ Créer « ${o.nom} »`
        : [h('span', null, o.ing.nom), h('small', null, categoryLabel(o.ing.categorie))])));
      list.hidden = options.length === 0;
      input.setAttribute('aria-expanded', String(!list.hidden));
      input.setAttribute('aria-activedescendant', active >= 0 ? `${listId}-${active}` : '');
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }

    function choose(idx) {
      const o = options[idx];
      if (!o) return;
      if (o.type === 'create') {
        const existing = findByName(o.nom) || findIngredient(slugify(o.nom));
        if (existing) { input.value = existing.nom; setId(existing.id); }
        else {
          const ing = { id: slugify(o.nom), nom: o.nom.charAt(0).toUpperCase() + o.nom.slice(1), categorie: 'autres' };
          formNewIngredients.set(ing.id, ing);
          input.value = ing.nom;
          setId(ing.id);
        }
      } else {
        input.value = o.ing.nom;
        setId(o.ing.id);
      }
      close();
      row.querySelector('[name="ing-qty"]').focus();
    }

    function move(delta) {
      if (list.hidden) { render(); return; }
      if (!options.length) return;
      active = (active + delta + options.length) % options.length;
      list.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
      input.setAttribute('aria-activedescendant', `${listId}-${active}`);
      list.children[active]?.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', () => {
      const exact = findByName(input.value);
      setId(exact ? exact.id : '');
      render();
    });
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter' && !list.hidden && active >= 0) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
    });

    return h('div', { class: 'ing-pick' }, input, list);
  }

  /** Affiche le choix de catégorie seulement pour un ingrédient créé dans ce formulaire. */
  function updateCategory(row) {
    const id = row.dataset.id;
    const isNew = id && formNewIngredients.has(id) && !state.ingMap.has(id);
    let select = row.querySelector('.ing-cat');
    if (!isNew) { select?.remove(); row.querySelector('.ing-cat-hint')?.remove(); return; }
    if (!select) {
      select = h('select', { class: 'ing-cat', 'aria-label': 'Catégorie du nouvel ingrédient' },
        C.CATEGORIES.map(([value, label]) => h('option', { value }, label)));
      select.addEventListener('change', () => {
        const ing = formNewIngredients.get(row.dataset.id);
        if (ing) ing.categorie = select.value;
      });
      row.append(h('p', { class: 'ing-hint ing-cat-hint' }, 'Nouvel ingrédient : choisis sa catégorie (il sera ajouté à la liste, mais pas au stock).'), select);
    }
    select.value = formNewIngredients.get(id).categorie;
  }

  function ingredientRow(ing = {}) {
    const row = h('div', { class: 'ing-row' });
    const known = ing.id ? findIngredient(ing.id) : (ing.name ? findByName(ing.name) : null);
    const id = ing.id || (known && known.id) || '';
    const text = known ? known.nom : (ing.name || ing.id || '');
    if (ing.label && ing.id) row.dataset.label = ing.label;

    const qty = h('input', { type: 'text', name: 'ing-qty', inputmode: 'decimal', 'aria-label': 'Quantité', placeholder: '4,5' });
    qty.value = ing.quantity == null ? '' : String(ing.quantity).replace('.', ',');
    const unit = h('input', { type: 'text', name: 'ing-unit', list: 'unit-list', 'aria-label': 'Unité', placeholder: 'cl' });
    unit.value = ing.unit ?? (ing.id || ing.name ? '' : 'cl');
    const optional = h('input', { type: 'checkbox', name: 'ing-opt' });
    optional.checked = !!ing.optionnel;

    row.append(
      ingredientPicker(row, id, text),
      qty,
      unit,
      h('label', { class: 'ing-opt', title: 'Un ingrédient optionnel manquant ne rend pas le cocktail indisponible' }, optional, 'Optionnel'),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer cet ingrédient', onclick: () => {
        const rows = row.parentElement;
        row.remove();
        if (!rows.children.length) rows.append(ingredientRow());
      } }, svgClose()));
    if (ing.label && ing.id) {
      row.append(h('p', { class: 'ing-hint ing-label-hint' }, `Affiché sur la carte : « ${ing.label} »`));
    }
    if (!id && text) row.classList.add('is-unknown');
    return row;
  }

  /* ==========================================================
     Formulaire d'ajout / modification
     ========================================================== */
  const editor = $('#editor');
  let editing = null;       // cocktail modifié (null = ajout)
  let pendingImage = null;  // { blob, ext } image compressée en attente d'envoi
  let busy = false;

  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('p', { class: 'field-hint' }, hint) : null);
  }
  function textInput(name, value, attrs = {}) {
    const el = h('input', { type: 'text', name, autocapitalize: 'sentences', ...attrs });
    el.value = value || '';
    return el;
  }

  const DEFAULT_ROWS = [{}, {}, {}, { id: 'glacons', quantity: null, unit: '' }];

  function openEditor(cocktail) {
    editing = cocktail || null;
    pendingImage = null;
    formNewIngredients = new Map();
    const c = cocktail || { name: '', ingredients: DEFAULT_ROWS, steps: [] };

    const rows = h('div', { class: 'ing-rows' }, (c.ingredients.length ? c.ingredients : [{}]).map(ingredientRow));
    const steps = h('textarea', { name: 'steps', rows: 5, placeholder: 'Verser…\nFrapper…\nFiltrer…' });
    steps.value = (c.steps || []).join('\n');
    const description = h('textarea', { name: 'description', rows: 2, style: 'min-height:72px', autocapitalize: 'sentences' });
    description.value = c.description || '';

    const preview = h('div', { class: 'image-preview' }, media(c.name ? c : { name: '?' }, c.name ? { alt: 'Aperçu de la photo' } : { src: null }));
    const fileInput = h('input', { type: 'file', name: 'image', accept: 'image/*', 'aria-label': 'Choisir une photo' });
    const imageStatus = h('p', { class: 'field-hint' }, 'Recadrée automatiquement en portrait 4:5 et convertie en WebP (1200 px max).');

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      imageStatus.textContent = 'Compression…';
      try {
        pendingImage = await compressImage(file);
        const url = URL.createObjectURL(pendingImage.blob);
        preview.replaceChildren(media({ name: c.name || '?' }, { src: url, alt: 'Aperçu de la nouvelle photo' }));
        imageStatus.textContent = `Prête : ${pendingImage.width} × ${pendingImage.height} px, ${Math.round(pendingImage.blob.size / 1024)} Ko (${pendingImage.ext.toUpperCase()}).`;
      } catch (err) {
        pendingImage = null;
        imageStatus.textContent = err.message;
      }
    });

    const progress = h('div', { class: 'editor-progress', role: 'status', hidden: true });
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-gold' }, 'Enregistrer');

    const form = h('form', { class: 'modal-inner', novalidate: true },
      h('div', { class: 'editor-head' },
        h('h2', { id: 'editor-title', class: 'modal-title' }, editing ? 'Modifier' : 'Nouveau cocktail'),
        h('button', { type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': 'Fermer le formulaire' }, svgClose())),

      field('Nom *', textInput('name', c.name, { required: true, placeholder: 'Mojito' }),
        editing ? null : 'Le nom sert aussi à nommer la photo (ex. « Piña colada » → pina-colada.webp).'),
      field('Description (une phrase)', description),

      h('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0 0 14px' },
        h('legend', { class: 'field-label' }, 'Ingrédients *'),
        h('p', { class: 'field-hint', style: 'margin:0 0 10px' }, 'Choisis chaque ingrédient dans la liste (ou crée-le). Coche « Optionnel » pour les garnitures : leur absence ne rend pas le cocktail indisponible.'),
        h('div', { class: 'ing-head', 'aria-hidden': 'true' }, h('span', null, 'Ingrédient'), h('span', null, 'Quantité'), h('span', null, 'Unité'), h('span', null, 'Optionnel'), h('span')),
        rows,
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', style: 'margin-top:10px', onclick: () => {
          const row = ingredientRow();
          rows.append(row);
          row.querySelector('input').focus();
        } }, '+ Ajouter un ingrédient'),
        h('datalist', { id: 'unit-list' }, ['cl', 'ml', 'trait(s)', 'cuillère(s) de bar', 'feuille(s)', 'pièce(s)', 'quartier(s)', 'g'].map((u) => h('option', { value: u })))),

      h('div', { class: 'field-row' },
        field('Verre', textInput('glass', c.glass, { placeholder: 'Coupe rafraîchie' })),
        field('Glace', textInput('ice', c.ice, { placeholder: 'Glaçons' }))),
      h('div', { class: 'field-row' },
        field('Technique', textInput('technique', c.technique, { placeholder: 'Shaker avec glace' })),
        field('Garniture', textInput('garnish', c.garnish, { placeholder: 'Rondelle de citron vert' }))),

      field('Étapes', steps, 'Une étape par ligne : elles seront numérotées automatiquement.'),

      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Photo'),
        h('div', { class: 'image-pick' }, preview, h('div', null, fileInput, imageStatus))),

      progress,

      h('div', { class: 'modal-actions' },
        editing ? h('button', { type: 'button', class: 'btn btn-danger btn-small', onclick: () => onDelete(progress) }, 'Supprimer') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn btn-ghost', 'data-close': true }, 'Annuler'),
        saveBtn));

    form.addEventListener('submit', (e) => { e.preventDefault(); onSave(form, progress); });

    editor.replaceChildren(form);
    editor.showModal();
    editor.scrollTop = 0;
    if (!editing) form.querySelector('[name="name"]').focus();
  }

  // pendant un envoi, on empêche de fermer la fenêtre
  editor.addEventListener('cancel', (e) => { if (busy) e.preventDefault(); });

  function setProgress(el, message, kind = '') {
    el.hidden = !message;
    el.className = `editor-progress ${kind}`;
    el.textContent = message || '';
    if (message) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function setBusy(form, on) {
    busy = on;
    form.querySelectorAll('button, input, textarea, select').forEach((el) => { el.disabled = on; });
  }

  /** Lit le formulaire et renvoie { draft, newIngredients } ou { error }. */
  function readForm(form) {
    const get = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const name = get('name');
    if (!name) return { error: 'Donne un nom au cocktail.', focus: form.elements.name };

    const ingredients = [];
    const used = new Set();
    for (const row of form.querySelectorAll('.ing-row')) {
      const pick = row.querySelector('[name="ing-name"]');
      const text = pick.value.trim();
      const qtyText = row.querySelector('[name="ing-qty"]').value.trim().replace(',', '.');
      const unit = row.querySelector('[name="ing-unit"]').value.trim();
      if (!text && !qtyText) continue;
      if (!text) return { error: 'Un ingrédient a une quantité mais pas de nom.', focus: pick };
      let id = row.dataset.id;
      if (!id) { const match = findByName(text); if (match) id = match.id; }
      if (!id) {
        row.classList.add('is-unknown');
        return { error: `« ${text} » n'est pas dans la liste des ingrédients : choisis-le dans la liste déroulante, ou choisis « + Créer ».`, focus: pick };
      }
      let quantity = null;
      if (qtyText) {
        quantity = Number(qtyText);
        if (!Number.isFinite(quantity) || quantity < 0) return { error: `La quantité de « ${text} » doit être un nombre (ex. 4,5).`, focus: row.querySelector('[name="ing-qty"]') };
      }
      const entry = { id };
      if (row.dataset.label && row.dataset.id === id) entry.label = row.dataset.label;
      entry.quantity = quantity;
      entry.unit = unit;
      if (row.querySelector('[name="ing-opt"]').checked) entry.optionnel = true;
      ingredients.push(entry);
      used.add(id);
    }
    if (!ingredients.length) return { error: 'Ajoute au moins un ingrédient.', focus: form.querySelector('[name="ing-name"]') };

    const steps = get('steps').split('\n').map((s) => s.trim().replace(/^\d+\s*[.)-]\s*/, '')).filter(Boolean);
    const newIngredients = [...formNewIngredients.values()].filter((i) => used.has(i.id) && !state.ingMap.has(i.id));
    return {
      newIngredients,
      draft: {
        name,
        description: get('description'),
        ingredients,
        glass: get('glass'),
        ice: get('ice'),
        technique: get('technique'),
        garnish: get('garnish'),
        steps,
      },
    };
  }

  /** Construit l'objet tel qu'il sera écrit dans le JSON (ordre des champs lisible). */
  function buildEntry(slug, draft, image, v) {
    const entry = {
      slug,
      name: draft.name,
      description: draft.description,
      ingredients: draft.ingredients,
      glass: draft.glass,
      ice: draft.ice,
      technique: draft.technique,
      garnish: draft.garnish,
      steps: draft.steps,
    };
    if (image && image !== `images/${slug}.webp`) entry.image = image;
    if (v) entry.v = v;
    return entry;
  }

  async function onSave(form, progress) {
    if (busy) return;
    const { draft, newIngredients, error, focus } = readForm(form);
    if (error) { setProgress(progress, error, 'error'); focus?.focus(); return; }

    const repo = ensureReady((msg) => setProgress(progress, msg, 'error'), () => onSave(form, progress));
    if (!repo) return;

    const slug = editing ? editing.slug : slugify(draft.name);
    if (!editing && state.cocktails.some((c) => c.slug === slug)) {
      setProgress(progress, `Un cocktail « ${draft.name} » existe déjà sur la carte.`, 'error');
      return;
    }

    setBusy(form, true);
    try {
      let imagePath = editing ? editing.image : undefined;
      let version = editing ? editing.v : undefined;
      let imageBase64 = null;
      if (pendingImage) {
        setProgress(progress, 'Préparation de la photo…');
        imagePath = `images/${slug}.${pendingImage.ext}`;
        imageBase64 = await blobToBase64(pendingImage.blob);
        version = Date.now().toString(36); // force les téléphones à recharger la nouvelle photo
      }

      setProgress(progress, 'Enregistrement sur GitHub…');
      const result = await commitChanges(repo, async (read) => {
        const cocktails = await readRemoteCocktails(read);
        const index = cocktails.findIndex((c) => c.slug === slug);
        if (!editing && index !== -1) throw new Error(`Un cocktail « ${draft.name} » existe déjà sur la carte en ligne. Recharge la page.`);
        const entry = buildEntry(slug, draft, imagePath, version);
        if (index === -1) cocktails.push(entry); else cocktails[index] = entry;

        const files = [];
        if (imageBase64) files.push({ path: imagePath, base64: imageBase64 });
        files.push({ path: PATHS.cocktails, text: serializeCocktails(cocktails) });

        let ingredients = null;
        if (newIngredients.length) {
          const merged = mergeIngredients(await readRemoteIngredients(read), newIngredients);
          ingredients = merged.list;
          if (merged.changed) files.push({ path: PATHS.ingredients, text: serializeIngredients(ingredients) });
        }
        return { files, result: { cocktails, ingredients } };
      }, `${editing ? 'Modification' : 'Ajout'} : ${draft.name}`);

      if (pendingImage) state.previews[slug] = URL.createObjectURL(pendingImage.blob);
      C.setData({ cocktails: result.cocktails, ingredients: result.ingredients || undefined });
      busy = false;
      editor.close();
      toast(`« ${draft.name} » est enregistré ✓ La carte publique sera à jour dans environ 1 minute (recharge la page pour vérifier).`, 'success', 9000);
      const entry = result.cocktails.find((c) => c.slug === slug);
      const av = entry && C.availability(entry);
      if (av && !av.available) {
        toast(`Pas en stock : ${av.missing.join(', ')}. Le cocktail s'affiche « Victime de son succès » tant que tu ne l'ajoutes pas dans Stock.`, 'info', 9000);
      }
      if (!editing) C.openCocktail(slug);
    } catch (err) {
      setProgress(progress, `Échec de l'enregistrement : ${err.message}`, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  async function onDelete(progress) {
    if (!editing || busy) return;
    const target = editing;
    if (!window.confirm(`Retirer « ${target.name} » de la carte ? Sa photo sera aussi supprimée du dépôt.`)) return;
    const repo = ensureReady((msg) => setProgress(progress, msg, 'error'), () => onDelete(progress));
    if (!repo) return;

    const form = editor.querySelector('form');
    setBusy(form, true);
    try {
      setProgress(progress, 'Suppression…');
      const imagePath = target.image || `images/${target.slug}.webp`;
      const list = await commitChanges(repo, async (read) => {
        const cocktails = (await readRemoteCocktails(read)).filter((c) => c.slug !== target.slug);
        const files = [{ path: PATHS.cocktails, text: serializeCocktails(cocktails) }];
        if (await getFile(repo, imagePath)) files.push({ path: imagePath, remove: true });
        return { files, result: cocktails };
      }, `Suppression : ${target.name}`);
      busy = false;
      editor.close();
      C.setData({ cocktails: list });
      toast(`« ${target.name} » a été retiré de la carte. Mise en ligne dans environ 1 minute.`, 'success', 8000);
    } catch (err) {
      setProgress(progress, `Échec de la suppression : ${err.message}`, 'error');
    } finally {
      setBusy(form, false);
    }
  }

  /* ---------- Branchement sur l'application ---------- */
  C.onAdd = () => openEditor(null);
  C.onEdit = (cocktail) => openEditor(cocktail);
  C.onSettings = () => openSettings();
  C.github = {
    getRepo, ensureReady, commitChanges, readRemoteIngredients, mergeIngredients,
    serializeIngredients, serializeStock, PATHS,
  };
  C.svgClose = svgClose;
})();
