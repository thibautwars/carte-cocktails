/*
 * Réglages de la carte — c'est le seul fichier à modifier pour personnaliser le site.
 * Attention : ce fichier est public (n'importe qui peut le lire). N'y mets JAMAIS ton token GitHub.
 */
window.CARTE_CONFIG = {
  // Titre affiché en haut de la page (et dans l'onglet du navigateur)
  title: "La Carte de Thibaut",

  // Petite ligne affichée au-dessus du titre
  subtitle: "Cocktails maison",

  // Code à 4 chiffres pour passer en mode hôte (appui long de 2 s sur le titre).
  // Ce n'est PAS une vraie sécurité : il sert juste à cacher les recettes aux invités.
  hostPin: "0612",

  // Dépôt GitHub utilisé par le formulaire d'ajout/modification.
  // Laisse vide : le site le devine tout seul une fois en ligne sur GitHub Pages
  // (https://<owner>.github.io/<repo>/). À remplir seulement si ça ne marche pas.
  github: {
    owner: "",
    repo: "",
    branch: "main"
  }
};
