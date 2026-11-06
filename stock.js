/* ==========================================================
   La Carte — écran « Stock » (mode hôte)
   - coche les ingrédients que tu as (présence / absence, sans quantité)
   - aperçu en direct des cocktails disponibles
   - « Enregistrer » = un seul commit : data/stock.json (+ data/ingredients.json si nouvel ingrédient)
   ========================================================== */
(() => {
  'use strict';
  const C = window.Carte;
  if (!C) return;
  const { h, $, toast, state, slugify } = C;

  const dialog = $('#stock-dialog');
  let draft = new Set();      // ids cochés pendant la modification
  let newIngredients = [];    // ingrédients créés dans cet écran (pas encore enregistrés)
  let busy = false;
  let els = {};

  const normalize = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const allIngredients = () => C.sortIngredients([...state.ingredients, ...newIngredients]);
  const savedStock = () => state.stock || new Set(state.ingredients.map((i) => i.id));

  function isDirty() {
    const saved = savedStock();
    if (newIngredients.length) return true;
    if (saved.size !== draft.size) return true;
    for (const id of draft) if (!saved.has(id)) return true;
    return false;
  }

  /* ---------- Ouverture ---------- */
  function open() {
    // stock inconnu (fichier absent) : on part de « tout est en stock »
    draft = new Set(savedStock());
    newIngredients = [];
    render();
    dialog.showModal();
    dialog.scrollTop = 0;
  }

  function render() {
    els.search = h('input', {
      type: 'search', class: 'search-input', placeholder: 'Rechercher un ingrédient…',
      'aria-label': 'Rechercher un ingrédient', autocomplete: 'off', oninput: renderList,
    });
    els.list = h('div', { class: 'stock-groups' });
    els.preview = h('div', { class: 'stock-preview', 'aria-live': 'polite' });
    els.progress = h('div', { class: 'editor-progress', role: 'status', hidden: true });
    els.save = h('button', { type: 'submit', class: 'btn btn-gold' }, 'Enregistrer');

    // petit formulaire « nouvel ingrédient »
    els.newName = h('input', { type: 'text', placeholder: 'Nom (ex. Sirop d\'orgeat)', 'aria-label': 'Nom du nouvel ingrédient', autocapitalize: 'sentences' });
    els.newCat = h('select', { 'aria-label': 'Catégorie' }, C.CATEGORIES.map(([v, l]) => h('option', { value: v }, l)));
    els.newError = h('p', { class: 'form-error', 'aria-live': 'polite' });
    const newForm = h('div', { class: 'new-ing-form', hidden: true },
      els.newName, els.newCat,
      h('button', { type: 'button', class: 'btn btn-gold btn-small', onclick: addIngredient }, 'Ajouter'));
    els.newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addIngredient(); } });
    els.newForm = newForm;

    const form = h('form', { class: 'modal-inner stock-dialog-inner', novalidate: true },
      h('div', { class: 'editor-head' },
        h('h2', { id: 'stock-title', class: 'modal-title' }, 'Stock'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fermer', onclick: requestClose }, C.svgClose())),
      h('p', { class: 'modal-text' }, 'Coche ce que tu as sous la main. Un cocktail dont un ingrédient obligatoire manque s\'affiche « Victime de son succès ». Les ingrédients optionnels (garnitures…) ne comptent pas.'),
      els.search,
      els.list,
      h('div', { class: 'new-ing' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-small', onclick: () => {
          newForm.hidden = !newForm.hidden;
          if (!newForm.hidden) els.newName.focus();
        } }, '+ Nouvel ingrédient'),
        newForm, els.newError),
      h('div', { class: 'stock-footer' },
        els.preview,
        els.progress,
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: requestClose }, 'Annuler'),
          els.save)));

    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
    els.form = form;
    dialog.replaceChildren(form);
    renderList();
    updatePreview();
  }

  /* ---------- Liste par catégorie, filtrée par la recherche ---------- */
  function renderList() {
    const q = normalize(els.search.value);
    const items = allIngredients().filter((i) => !q || normalize(i.nom).includes(q));
    const groups = C.CATEGORIES.map(([cat, label]) => {
      const inCat = items.filter((i) => (C.CATEGORIES.some(([c]) => c === i.categorie) ? i.categorie : 'autres') === cat);
      if (!inCat.length) return null;
      return h('section', { class: 'stock-group' },
        h('h3', null, label),
        h('ul', { class: 'stock-list' }, inCat.map(stockRow)));
    }).filter(Boolean);
    els.list.replaceChildren(...(groups.length ? groups : [h('p', { class: 'stock-empty' }, 'Aucun ingrédient ne correspond à cette recherche.')]));
  }

  function stockRow(ing) {
    const checked = draft.has(ing.id);
    const box = h('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': `${ing.nom} en stock` });
    box.checked = checked;
    const li = h('li', null, h('label', { class: `stock-row${checked ? '' : ' is-off'}` },
      h('span', { class: 'stock-name' }, ing.nom,
        newIngredients.some((n) => n.id === ing.id) ? h('small', { class: 'tag' }, 'nouveau') : null),
      box));
    box.addEventListener('change', () => {
      if (box.checked) draft.add(ing.id); else draft.delete(ing.id);
      li.firstChild.classList.toggle('is-off', !box.checked);
      updatePreview();
    });
    return li;
  }

  function addIngredient() {
    const nom = els.newName.value.trim();
    els.newError.textContent = '';
    if (!nom) { els.newError.textContent = 'Donne un nom à l\'ingrédient.'; els.newName.focus(); return; }
    const id = slugify(nom);
    const existing = allIngredients().find((i) => i.id === id || normalize(i.nom) === normalize(nom));
    if (existing) { els.newError.textContent = `« ${existing.nom} » existe déjà dans la liste.`; return; }
    const ing = { id, nom: nom.charAt(0).toUpperCase() + nom.slice(1), categorie: els.newCat.value };
    newIngredients.push(ing);
    draft.add(id); // un ingrédient qu'on ajoute, on l'a en général sous la main
    els.newName.value = '';
    els.search.value = '';
    renderList();
    updatePreview();
    toast(`« ${ing.nom} » ajouté (en stock). N'oublie pas d'enregistrer.`);
  }

  /* ---------- Aperçu en direct ---------- */
  function updatePreview() {
    const before = savedStock();
    const total = state.cocktails.length;
    let available = 0;
    const lost = [];
    const gained = [];
    for (const c of state.cocktails) {
      const now = C.availability(c, draft).available;
      const was = C.availability(c, before).available;
      if (now) available++;
      if (was && !now) lost.push(c.name);
      if (!was && now) gained.push(c.name);
    }
    els.preview.replaceChildren(...[
      h('p', { style: 'margin:0' }, h('strong', null, `${available} / ${total}`), ` cocktail${total > 1 ? 's' : ''} disponible${total > 1 ? 's' : ''} avec ce stock`),
      lost.length ? h('p', { class: 'lost' }, `Passent indisponibles : ${lost.join(', ')}`) : null,
      gained.length ? h('p', { class: 'gained' }, `Redeviennent disponibles : ${gained.join(', ')}`) : null,
    ].filter(Boolean));
    els.save.disabled = busy;
  }

  /* ---------- Fermeture ---------- */
  function requestClose() {
    if (busy) return;
    if (isDirty() && !window.confirm('Abandonner les modifications du stock ?')) return;
    dialog.close();
  }
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); }); // touche Échap

  /* ---------- Enregistrement (un seul commit) ---------- */
  function setProgress(message, kind = '') {
    els.progress.hidden = !message;
    els.progress.className = `editor-progress ${kind}`;
    els.progress.textContent = message || '';
  }

  async function save() {
    if (busy) return;
    if (!isDirty()) { dialog.close(); toast('Aucune modification du stock.'); return; }
    const repo = C.github.ensureReady((msg) => setProgress(msg, 'error'), save);
    if (!repo) return;

    busy = true;
    els.form.querySelectorAll('button, input, select').forEach((el) => { el.disabled = true; });
    setProgress('Enregistrement sur GitHub…');
    try {
      const ids = [...draft].sort((a, b) => a.localeCompare(b));
      const additions = [...newIngredients];
      const result = await C.github.commitChanges(repo, async (read) => {
        const files = [{ path: C.github.PATHS.stock, text: C.github.serializeStock(ids) }];
        let ingredients = null;
        if (additions.length) {
          const merged = C.github.mergeIngredients(await C.github.readRemoteIngredients(read), additions);
          ingredients = merged.list;
          if (merged.changed) files.push({ path: C.github.PATHS.ingredients, text: C.github.serializeIngredients(ingredients) });
        }
        return { files, result: { ingredients } };
      }, additions.length ? `Stock : mise à jour (+ ${additions.map((i) => i.nom).join(', ')})` : 'Stock : mise à jour');

      C.setData({ stock: ids, ingredients: result.ingredients || undefined });
      busy = false;
      dialog.close();
      const available = state.cocktails.filter((c) => C.availability(c).available).length;
      toast(`Stock enregistré ✓ (${available}/${state.cocktails.length} cocktails disponibles). La carte publique sera à jour dans environ 1 minute.`, 'success', 9000);
    } catch (err) {
      setProgress(`Échec de l'enregistrement : ${err.message}`, 'error');
    } finally {
      busy = false;
      if (dialog.open) els.form.querySelectorAll('button, input, select').forEach((el) => { el.disabled = false; });
    }
  }

  C.onStock = open;
})();
