# La Carte de Thibaut 🍸

Une carte de cocktails interactive, pensée pour le téléphone : les invités scannent le QR code, parcourent les cocktails, et toi seul (en « mode hôte ») vois les recettes, calcules les doses, ajoutes de nouveaux cocktails et gères ton stock d'ingrédients.

Adresse prévue : **https://thibautwars.github.io/carte-cocktails/**

---

## 1. Ce que contient le dossier

| Fichier | À quoi il sert |
|---|---|
| `index.html` | La structure de la page. |
| `style.css` | Le design (couleurs, polices, tailles). Les couleurs se changent tout en haut, dans `:root`. |
| `config.js` | **Tes réglages** : titre, sous-titre, code PIN, dépôt GitHub. |
| `app.js` | L'application : grille, fiche, recette, calcul des doses, disponibilité selon le stock, mode hôte. |
| `editor.js` | L'enregistrement sur GitHub et le formulaire d'ajout / modification de cocktail. |
| `stock.js` | L'écran « Stock » du mode hôte. |
| `data/cocktails.json` | **La liste des cocktails** (la seule source des recettes). |
| `data/ingredients.json` | **La liste de tous les ingrédients** (id, nom, catégorie). |
| `data/stock.json` | **Les ingrédients que tu as** en ce moment. |
| `images/` | Une photo par cocktail : `images/<slug>.webp` (ex. `images/pina-colada.webp`), format portrait 4:5. |
| `IMAGE_PROMPTS.md` | Les prompts pour générer les photos, avec le nom de fichier exact de chacune. |
| `qrcode.png` | Le QR code vers le site en ligne. |

Le « slug » d'un cocktail, c'est son nom simplifié : minuscules, sans accents, avec des tirets. *Piña colada* donne `pina-colada`.

---

## 2. Voir le site sur ton Mac (avant de le mettre en ligne)

Le site doit être ouvert via un petit serveur local : un double-clic sur `index.html` ne marche pas, car le navigateur refuse alors de lire `data/cocktails.json`.

1. Ouvre l'app **Terminal** (Cmd + Espace, tape « Terminal », Entrée).
2. Va dans le dossier du site :
   ```bash
   cd ~/Desktop/Cocktail
   ```
3. Lance le serveur :
   ```bash
   python3 -m http.server 8000
   ```
   Si macOS te demande d'installer les « outils de ligne de commande », accepte, puis relance la commande.
4. Ouvre **http://localhost:8000** dans ton navigateur.
5. Pour arrêter le serveur : reviens dans le Terminal et appuie sur **Ctrl + C**.

Pour voir le rendu « téléphone » dans Chrome : clic droit → *Inspecter*, puis l'icône téléphone/tablette en haut à gauche du panneau.

---

## 3. Mettre le site en ligne avec GitHub Pages (gratuit)

### 3.1 Créer le dépôt

1. Connecte-toi sur **https://github.com** (compte `thibautwars`).
2. En haut à droite, clique sur **+** puis **New repository**.
3. **Repository name** : `carte-cocktails` (exactement ce nom, sinon le QR code ne pointera pas au bon endroit : voir §8).
4. Coche **Public**. GitHub Pages n'est gratuit que pour les dépôts publics.
5. Ne coche **rien** d'autre (pas de README, pas de .gitignore, pas de licence).
6. Clique sur **Create repository**.

### 3.2 Envoyer les fichiers

1. Sur la page du dépôt vide, clique sur le lien **uploading an existing file**.
2. Dans le Finder, ouvre le dossier `Cocktail`, sélectionne **tout son contenu** (Cmd + A) : `index.html`, `style.css`, `config.js`, `app.js`, `editor.js`, `stock.js`, `README.md`, `IMAGE_PROMPTS.md`, `qrcode.png` et les dossiers `data` et `images`.
3. **Fais glisser** le tout avec la souris dans la zone de dépôt de la page GitHub (n'utilise pas « choose your files » : cette fenêtre ne prend pas les dossiers). Glisse bien le **contenu** du dossier, pas le dossier `Cocktail` lui-même. Dans la liste qui s'affiche, tu dois voir `data/cocktails.json`, `data/ingredients.json` et `data/stock.json`.
4. Attends que la liste des fichiers s'affiche, puis clique sur **Commit changes** en bas.

> Le dossier `images` est vide au départ ? GitHub ignore les dossiers vides. Ce n'est pas grave : il sera créé dès la première photo.

### 3.3 Activer GitHub Pages

1. Dans le dépôt, onglet **Settings** (roue dentée), puis menu de gauche **Pages**.
2. Sous **Build and deployment** → **Source** : choisis **Deploy from a branch**.
3. **Branch** : `main`, dossier `/ (root)`, puis **Save**.
4. Attends 1 à 2 minutes, puis recharge la page des réglages : l'adresse **https://thibautwars.github.io/carte-cocktails/** apparaît en haut. Ouvre-la : ta carte est en ligne 🎉

Ensuite, chaque modification du dépôt (par le formulaire ou à la main) remet le site à jour tout seul, en **environ 1 minute**. Tu peux suivre ça dans l'onglet **Actions** du dépôt.

---

## 4. Le mode hôte

- **Pour l'activer** : appui long de **2 secondes** sur le titre « La Carte de Thibaut » (un trait doré se remplit sous le titre), puis saisie du code à 4 chiffres.
- Le code par défaut est **`1234`**. **Change-le** dans `config.js` (ligne `hostPin`).
- Le mode reste actif sur cet appareil, même après fermeture du navigateur, jusqu'à ce que tu touches **Quitter** dans la barre du bas.
- En mode hôte, chaque fiche affiche un bouton **Recette** (quantités, verre, glace, technique, garniture, étapes, nombre de verres) et un bouton **Modifier**. La barre du bas permet d'**ajouter** un cocktail, de gérer le **Stock** et de régler la **connexion GitHub**.
- En mode hôte, un encadré « À vérifier » apparaît en haut de la carte si un fichier contient un ingrédient inconnu. Les invités ne le voient jamais.

> ⚠️ **Ce n'est pas une vraie sécurité.** Le mode hôte se contente de cacher des boutons. Les recettes complètes sont dans `data/cocktails.json`, ton stock dans `data/stock.json` et le code PIN dans `config.js` : ces deux fichiers sont publics, et n'importe qui de curieux peut les lire. C'est fait pour garder la surprise à tes invités, pas pour protéger un secret.

---

## 5. Gérer le stock

Le stock dit quels ingrédients tu as **en ce moment** (présence ou absence, sans quantité). La carte en déduit toute seule quels cocktails sont disponibles.

**La règle :** un cocktail est disponible si **tous ses ingrédients obligatoires** sont en stock. Les ingrédients marqués « optionnel » (garnitures, menthe, quartier d'ananas…) ne comptent jamais.

**Ce que voient les invités** quand un cocktail n'est pas disponible : sa carte reste visible, mais grisée, avec le bandeau doré « Victime de son succès », et elle passe en fin de grille. La fiche reste consultable avec le même bandeau.

**Ce que tu vois en plus en mode hôte :** la liste de ce qui manque, sur la carte et dans la fiche (ex. « Manque : citron vert »). Dans la recette, les ingrédients absents sont marqués « pas en stock ».

### Mettre à jour le stock

1. Active le mode hôte, puis touche **Stock** dans la barre du bas.
2. Coche ou décoche les ingrédients (ils sont rangés par catégorie : alcools, sirops, jus et softs, frais, autres). La barre de recherche filtre la liste.
3. En bas, l'aperçu indique en direct combien de cocktails restent disponibles, et lesquels passent indisponibles avec tes changements.
4. Un ingrédient manque à la liste ? **+ Nouvel ingrédient** : donne son nom et sa catégorie. Il est ajouté coché.
5. Touche **Enregistrer**. Tout part sur GitHub en **une seule fois** (un seul « commit ») : la carte publique est à jour dans **environ 1 minute**.

Le stock utilise le même token GitHub que le formulaire des cocktails (§6).

---

## 6. Créer le token GitHub (une seule fois)

Le formulaire du mode hôte enregistre directement dans ton dépôt. Pour cela, il lui faut un **token**, une clé d'accès que tu limites à ce seul dépôt.

1. Sur GitHub, clique sur ta photo en haut à droite → **Settings**.
2. Tout en bas du menu de gauche : **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
   (Lien direct : https://github.com/settings/personal-access-tokens/new)
4. Remplis :
   - **Token name** : `carte-cocktails`
   - **Expiration** : la durée la plus longue proposée (par exemple 1 an). Note la date : il faudra en refaire un après.
   - **Repository access** : **Only select repositories**, puis choisis `thibautwars/carte-cocktails`.
   - **Permissions** → **Repository permissions** → **Contents** : **Read and write**. (« Metadata : Read-only » s'ajoute tout seul, c'est normal.) Ne touche à rien d'autre.
5. Clique sur **Generate token**, puis **copie** le token (il commence par `github_pat_…`). GitHub ne te le montrera **qu'une seule fois**.
6. Sur ton téléphone : ouvre la carte, active le mode hôte, touche **GitHub** dans la barre du bas, colle le token, puis **Tester et enregistrer**.

À savoir :
- Le token est stocké **uniquement dans le navigateur de ton téléphone** (localStorage). Il n'est écrit dans aucun fichier et n'est envoyé qu'à `api.github.com`.
- **Ne le colle jamais** dans `config.js` ni dans un autre fichier du dépôt : tout le monde pourrait le lire.
- Pour l'utiliser sur un autre appareil, il faut le recoller sur cet appareil.
- Téléphone perdu ou doute ? Sur GitHub, *Settings → Developer settings → Fine-grained tokens*, ouvre le token puis **Delete** : il ne marche plus immédiatement. Le bouton **Oublier le token** de la carte l'efface de l'appareil.

---

## 7. Ajouter, modifier ou supprimer un cocktail

### Avec le formulaire (le plus simple)

1. Mode hôte → **+ Ajouter** (ou **Modifier** dans une fiche).
2. Remplis le nom, la description, le verre, la glace, la technique, la garniture et les étapes (une par ligne).
3. **Ingrédients** : pour chaque ligne, tape quelques lettres et **choisis l'ingrédient dans la liste** qui s'ouvre. S'il n'existe pas encore, choisis **+ Créer « … »** puis sa catégorie : il sera ajouté à `data/ingredients.json`, mais **pas** au stock. Indique la quantité et l'unité, et coche **Optionnel** pour une garniture. Les glaçons sont proposés d'office.
4. Choisis une photo : elle est automatiquement recadrée en portrait 4:5, réduite à 1200 px de large et convertie en WebP, directement sur ton téléphone.
5. **Enregistrer** (un seul commit pour la photo, la recette et les nouveaux ingrédients). La carte se met à jour tout de suite sur ton téléphone. Pour les invités, il faut attendre **environ 1 minute** (le temps que GitHub Pages republie le site).

**Supprimer** se trouve en bas du formulaire de modification. Un historique de chaque changement est conservé dans le dépôt (onglet *Commits*), donc rien n'est vraiment perdu.

### À la main (sur GitHub)

1. Dans le dépôt, ouvre `data/cocktails.json`, puis clique sur le crayon ✏️ (*Edit this file*).
2. Copie un bloc de cocktail existant, de `{` à `}`, colle-le après une virgule et adapte-le :
   ```json
   {
     "slug": "mojito",
     "name": "Mojito",
     "description": "Menthe fraîche, citron vert et rhum : la fraîcheur cubaine.",
     "ingredients": [
       { "id": "rhum-blanc", "quantity": 5, "unit": "cl" },
       { "id": "citron-vert", "label": "Jus de citron vert", "quantity": 2.5, "unit": "cl" },
       { "id": "glacons", "quantity": null, "unit": "" },
       { "id": "menthe", "label": "Feuilles de menthe", "quantity": 8, "unit": "feuille(s)", "optionnel": true }
     ],
     "glass": "Highball",
     "ice": "Glace pilée",
     "technique": "Construit dans le verre",
     "garnish": "Branche de menthe",
     "steps": [
       "Piler doucement la menthe avec le citron vert.",
       "Ajouter le rhum et remplir de glace pilée.",
       "Remuer et garnir."
     ]
   }
   ```
3. Règles à respecter :
   - Les quantités s'écrivent avec un **point** et **sans guillemets** : `7.5`, pas `"7,5"`.
   - Une **virgule entre deux cocktails**, mais **pas après le dernier**.
   - Le `slug` doit être unique : c'est aussi le nom de la photo (`images/mojito.webp`).
   - Chaque `id` d'ingrédient doit exister dans `data/ingredients.json` (sinon, un avertissement s'affiche en mode hôte).
4. Clique sur **Commit changes**.

Si le fichier contient une erreur, le site affiche un message clair (avec le numéro de ligne quand c'est possible) au lieu de la carte : corrige le fichier et recharge la page.

### Structure des 3 fichiers de données

**`data/ingredients.json`** : la liste de référence de tous les ingrédients.
```json
{
  "ingredients": [
    { "id": "citron-vert", "nom": "Citron vert", "categorie": "frais" }
  ]
}
```
- `id` : identifiant unique (minuscules, sans accents, avec des tirets). C'est lui qu'utilisent les recettes et le stock.
- `nom` : le nom affiché.
- `categorie` : `alcools`, `sirops`, `jus-softs`, `frais` ou `autres` (pour ranger l'écran Stock).

**`data/stock.json`** : les `id` des ingrédients que tu as en ce moment.
```json
{
  "stock": ["citron-vert", "glacons", "rhum-blanc"]
}
```

**`data/cocktails.json`** : les recettes. Chaque ingrédient d'une recette pointe vers un `id` de `ingredients.json` :
```json
{ "id": "citron-vert", "label": "Jus de citron vert", "quantity": 3, "unit": "cl" }
```
- `id` : l'ingrédient de référence (c'est lui qui est comparé au stock).
- `label` (facultatif) : le texte affiché sur la carte, s'il diffère du nom de référence. Ici, on affiche « Jus de citron vert » mais c'est le **citron vert** qui doit être en stock.
- `quantity` : un nombre avec un point (`7.5`), ou `null` s'il n'y a pas de quantité (glaçons).
- `unit` : `cl`, `ml`, `feuille(s)`… ou vide.
- `optionnel` (facultatif) : `true` pour une garniture ou un ingrédient facultatif. Son absence ne rend jamais le cocktail indisponible.

Si `stock.json` ou `ingredients.json` est absent ou mal écrit, la carte s'affiche quand même (tous les cocktails sont alors considérés comme disponibles) et un avertissement apparaît en mode hôte.

### Les photos

- Les prompts sont dans `IMAGE_PROMPTS.md`, avec le nom de fichier exact de chaque photo.
- Format : **portrait 4:5**, idéalement en `.webp`, nommée avec le slug : `images/pina-colada.webp`.
- Pour les ajouter à la main : dans le dépôt, ouvre le dossier `images` → **Add file** → **Upload files**.
- Tant qu'une photo manque, la carte affiche un fond élégant avec l'initiale du cocktail.

---

## 8. Le QR code

`qrcode.png` pointe vers **https://thibautwars.github.io/carte-cocktails/**. Imprime-le, ou affiche-le sur une tablette au bar.

Pour le régénérer (autre nom de dépôt, autre adresse), ouvre le Terminal dans le dossier du site et lance (Node.js doit être installé, il l'est déjà sur ton Mac) :

```bash
npx --yes qrcode@1.5.4 -o qrcode.png -w 1024 -q 2 -e M -d 0e0c0aff -l f5eee2ff "https://thibautwars.github.io/carte-cocktails/"
```

Remplace l'adresse entre guillemets si besoin. Tu peux aussi utiliser n'importe quel générateur de QR code en ligne. Teste toujours le QR code avec ton téléphone avant de l'imprimer.

---

## 9. Personnaliser

- **Titre, sous-titre, code PIN** : dans `config.js`.
- **Couleurs** : en haut de `style.css` (`--gold` pour l'or, `--bg` pour le fond…).
- **Dépôt GitHub** : laisse `github.owner` et `github.repo` vides dans `config.js`, le site les devine à partir de son adresse. Ne les remplis que si tu utilises un nom de domaine personnalisé.

---

## 10. En cas de problème

| Symptôme | Solution |
|---|---|
| « Impossible de charger la carte » en local | Tu as ouvert `index.html` par double-clic. Utilise le serveur local (§2). |
| « La carte contient une erreur » | Une virgule ou un guillemet manque dans `data/cocktails.json`. Le message indique la ligne. |
| Mes changements n'apparaissent pas | Attends 1 à 2 minutes, puis recharge la page. Vérifie l'onglet **Actions** du dépôt (une coche verte = publié). |
| « Token GitHub refusé » | Le token a expiré ou a été supprimé : crée-en un nouveau (§6). |
| « Le token n'a pas le droit d'écrire » | Le token doit avoir **Contents : Read and write** sur le dépôt `carte-cocktails`. |
| « Dépôt introuvable » | Le token n'a pas accès à ce dépôt (Repository access), ou le dépôt a un autre nom. |
| J'ai oublié le code PIN | Il est dans `config.js`. |
| Un cocktail est « Victime de son succès » alors que j'ai tout | En mode hôte, regarde la ligne « Manque : … » sur sa carte, puis coche cet ingrédient dans **Stock**. |
| Encadré « À vérifier » en mode hôte | Un `id` d'ingrédient n'existe pas dans `data/ingredients.json` : ajoute-le avec **Stock → + Nouvel ingrédient**, ou corrige la recette avec **Modifier**. |
