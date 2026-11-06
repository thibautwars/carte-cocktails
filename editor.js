/* ==========================================================
   La Carte — formulaire d'ajout / modification (mode hôte)
   Enregistre directement dans le dépôt GitHub via l'API « contents » :
     - l'image va dans images/<slug>.webp
     - la recette va dans data/cocktails.json
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
  const DATA_PATH = 'data/cocktails.json';
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
  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
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
      case 409: return 'Le fichier a changé sur GitHub pendant l\'envoi. Réessaie.';
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

  const contentsUrl = (repo, path) =>
    `/repos/${repo.owner}/${repo.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;

  const getFile = (repo, path) =>
    gh(`${contentsUrl(repo, path)}?ref=${encodeURIComponent(repo.branch)}`, { allow404: true });

  const putFile = (repo, path, contentBase64, message, sha) =>
    gh(contentsUrl(repo, path), { method: 'PUT', body: { message, content: contentBase64, branch: repo.branch, ...(sha ? { sha } : {}) } });

  const deleteFile = (repo, path, message, sha) =>
    gh(contentsUrl(repo, path), { method: 'DELETE', body: { message, sha, branch: repo.branch } });

  /** Lit la version en ligne de cocktails.json (pour ne jamais écraser une modif faite ailleurs). */
  async function readRemoteCocktails(repo) {
    const file = await getFile(repo, DATA_PATH);
    if (!file) return { list: [], sha: undefined };
    const result = C.parseCocktails(base64ToUtf8(file.content));
    if (result.errors.length) throw new Error(`Le fichier ${DATA_PATH} sur GitHub contient une erreur : ${result.errors[0]}`);
    return { list: result.cocktails, sha: file.sha };
  }

  /** Lit le JSON en ligne, applique la modification, renvoie le tout (avec 1 nouvel essai en cas de conflit). */
  async function commitCocktails(repo, mutate, message) {
    for (let attempt = 0; ; attempt++) {
      const { list, sha } = await readRemoteCocktails(repo);
      const next = mutate(list);
      const json = `${JSON.stringify({ cocktails: next }, null, 2)}\n`;
      try {
        await putFile(repo, DATA_PATH, utf8ToBase64(json), message, sha);
        return next;
      } catch (err) {
        if ((err.status === 409 || err.status === 422) && attempt === 0) continue;
        throw err;
      }
    }
  }

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
        h('button', { type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': 'Fermer' },
          svgClose())),
      h('p', { class: 'modal-text' },
        'Pour enregistrer tes cocktails, le site a besoin d\'un token GitHub (une clé d\'accès limitée à ton dépôt). ',
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
      statusEl.style.color = '';
      statusEl.textContent = 'Vérification…';
      try {
        if (repo) await gh(`/repos/${repo.owner}/${repo.repo}`, { token });
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

  /* ==========================================================
     Formulaire d'ajout / modification
     ========================================================== */
  const editor = $('#editor');
  let editing = null;       // cocktail modifié (null = ajout)
  let pendingImage = null;  // { blob, ext } image compressée en attente d'envoi
  let busy = false;

  const svgClose = () => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M6 6l12 12M18 6L6 18');
    s.append(p);
    return s;
  };

  function ingredientRow(ing = {}) {
    const row = h('div', { class: 'ing-row' },
      h('input', { type: 'text', name: 'ing-name', 'aria-label': 'Ingrédient', placeholder: 'Rhum blanc', autocapitalize: 'sentences' }),
      h('input', { type: 'text', name: 'ing-qty', inputmode: 'decimal', 'aria-label': 'Quantité', placeholder: '4,5' }),
      h('input', { type: 'text', name: 'ing-unit', list: 'unit-list', 'aria-label': 'Unité', placeholder: 'cl' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Retirer cet ingrédient', onclick: () => {
        const rows = row.parentElement;
        row.remove();
        if (!rows.children.length) rows.append(ingredientRow());
      } }, svgClose()));
    row.querySelector('[name="ing-name"]').value = ing.name || '';
    row.querySelector('[name="ing-qty"]').value = ing.quantity == null ? '' : String(ing.quantity).replace('.', ',');
    row.querySelector('[name="ing-unit"]').value = ing.unit ?? (ing.name ? '' : 'cl');
    return row;
  }

  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('p', { class: 'field-hint' }, hint) : null);
  }
  function textInput(name, value, attrs = {}) {
    const el = h('input', { type: 'text', name, autocapitalize: 'sentences', ...attrs });
    el.value = value || '';
    return el;
  }

  function openEditor(cocktail) {
    editing = cocktail || null;
    pendingImage = null;
    const c = cocktail || { name: '', ingredients: [{}, {}, {}], steps: [] };

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
        h('h2', { id: 'editor-title', class: 'modal-title' }, editing ? `Modifier` : 'Nouveau cocktail'),
        h('button', { type: 'button', class: 'icon-btn', 'data-close': true, 'aria-label': 'Fermer le formulaire' }, svgClose())),

      field('Nom *', textInput('name', c.name, { required: true, placeholder: 'Mojito' }),
        editing ? null : 'Le nom sert aussi à nommer la photo (ex. « Piña colada » → pina-colada.webp).'),
      field('Description (une phrase)', description),

      h('fieldset', { class: 'field', style: 'border:0;padding:0;margin:0 0 14px' },
        h('legend', { class: 'field-label' }, 'Ingrédients *'),
        h('div', { class: 'ing-head', 'aria-hidden': 'true' }, h('span', null, 'Nom'), h('span', null, 'Quantité'), h('span', null, 'Unité'), h('span')),
        rows,
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', style: 'margin-top:10px', onclick: () => {
          const row = ingredientRow();
          rows.append(row);
          row.querySelector('input').focus();
        } }, '+ Ajouter un ingrédient'),
        h('datalist', { id: 'unit-list' }, ['cl', 'ml', 'trait(s)', 'cuillère(s) de bar', 'feuille(s)', 'pièce(s)', 'g'].map((u) => h('option', { value: u })))),

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
    form.querySelectorAll('button, input, textarea').forEach((el) => { el.disabled = on; });
  }

  /** Lit le formulaire et renvoie { draft } ou { error }. */
  function readForm(form) {
    const get = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
    const name = get('name');
    if (!name) return { error: 'Donne un nom au cocktail.', focus: form.elements.name };

    const ingredients = [];
    for (const row of form.querySelectorAll('.ing-row')) {
      const ingName = row.querySelector('[name="ing-name"]').value.trim();
      const qtyText = row.querySelector('[name="ing-qty"]').value.trim().replace(',', '.');
      const unit = row.querySelector('[name="ing-unit"]').value.trim();
      if (!ingName && !qtyText) continue;
      if (!ingName) return { error: 'Un ingrédient a une quantité mais pas de nom.', focus: row.querySelector('[name="ing-name"]') };
      let quantity = null;
      if (qtyText) {
        quantity = Number(qtyText);
        if (!Number.isFinite(quantity) || quantity < 0) return { error: `La quantité de « ${ingName} » doit être un nombre (ex. 4,5).`, focus: row.querySelector('[name="ing-qty"]') };
      }
      ingredients.push({ name: ingName, quantity, unit });
    }
    if (!ingredients.length) return { error: 'Ajoute au moins un ingrédient.', focus: form.querySelector('[name="ing-name"]') };

    const steps = get('steps').split('\n').map((s) => s.trim().replace(/^\d+\s*[.)-]\s*/, '')).filter(Boolean);
    return {
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
    const { draft, error, focus } = readForm(form);
    if (error) { setProgress(progress, error, 'error'); focus?.focus(); return; }

    const repo = getRepo();
    if (!repo) {
      setProgress(progress, 'Dépôt GitHub inconnu. Une fois le site en ligne sur GitHub Pages, il est détecté tout seul ; en local, remplis github.owner et github.repo dans config.js.', 'error');
      return;
    }
    if (!storage.get(KEY_TOKEN)) {
      openSettings({ then: () => onSave(form, progress) });
      return;
    }

    const slug = editing ? editing.slug : slugify(draft.name);
    if (!editing && state.cocktails.some((c) => c.slug === slug)) {
      setProgress(progress, `Un cocktail « ${draft.name} » existe déjà sur la carte.`, 'error');
      return;
    }

    setBusy(form, true);
    try {
      let imagePath = editing ? editing.image : undefined;
      let version = editing ? editing.v : undefined;

      if (pendingImage) {
        setProgress(progress, 'Envoi de la photo…');
        imagePath = `images/${slug}.${pendingImage.ext}`;
        const existing = await getFile(repo, imagePath);
        await putFile(repo, imagePath, await blobToBase64(pendingImage.blob), `Photo : ${draft.name}`, existing && existing.sha);
        version = Date.now().toString(36); // force les téléphones à recharger la nouvelle photo
      }

      setProgress(progress, 'Mise à jour de la carte…');
      const list = await commitCocktails(repo, (current) => {
        const index = current.findIndex((c) => c.slug === slug);
        if (!editing && index !== -1) throw new Error(`Un cocktail « ${draft.name} » existe déjà sur la carte en ligne. Recharge la page.`);
        const entry = buildEntry(slug, draft, imagePath, version);
        if (index === -1) current.push(entry); else current[index] = entry;
        return current;
      }, `${editing ? 'Modification' : 'Ajout'} : ${draft.name}`);

      if (pendingImage) state.previews[slug] = URL.createObjectURL(pendingImage.blob);
      C.setCocktails(list);
      busy = false;
      editor.close();
      toast(`« ${draft.name} » est enregistré ✓ La carte publique sera à jour dans environ 1 minute (recharge la page pour vérifier).`, 'success', 9000);
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
    const repo = getRepo();
    if (!repo) { setProgress(progress, 'Dépôt GitHub inconnu (voir config.js).', 'error'); return; }
    if (!storage.get(KEY_TOKEN)) { openSettings({ then: () => onDelete(progress) }); return; }

    const form = editor.querySelector('form');
    setBusy(form, true);
    try {
      setProgress(progress, 'Suppression…');
      const list = await commitCocktails(repo, (current) => current.filter((c) => c.slug !== target.slug), `Suppression : ${target.name}`);
      const imagePath = target.image || `images/${target.slug}.webp`;
      try {
        const file = await getFile(repo, imagePath);
        if (file) await deleteFile(repo, imagePath, `Suppression de la photo : ${target.name}`, file.sha);
      } catch { /* la recette est déjà retirée ; la photo restante n'est pas grave */ }
      busy = false;
      editor.close();
      C.setCocktails(list);
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
  C.getRepo = getRepo;
})();
