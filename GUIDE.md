# Guide d'installation — Second Brain (application de bureau)

Ce guide s'adresse à **tout le monde**, sans connaissance technique. Second Brain est
une application que tu installes sur ton ordinateur : chacun a **son propre wiki, en
local**, sur sa machine. Rien n'est partagé automatiquement entre collègues.

---

## 1. Installer l'application

### Sur Mac
1. Ouvre le fichier **`SecondBrain-0.1.0-arm64.dmg`** qu'on t'a partagé (double-clic).
2. Une fenêtre s'ouvre : **glisse l'icône `SecondBrain`** sur le dossier **`Applications`**.
3. C'est installé. Tu peux éjecter le disque « SecondBrain » (clic droit → Éjecter).

### Sur Windows
1. Lance le fichier **`SecondBrain Setup 0.1.0.exe`** qu'on t'a partagé (double-clic).
2. Laisse l'installation se dérouler. Un raccourci apparaît sur le Bureau / le menu Démarrer.

---

## 2. Première ouverture : passer l'alerte de sécurité

L'application n'est **pas signée** (v1). Ton ordinateur va donc afficher un avertissement
la **première fois** seulement. C'est normal — il suffit de confirmer que tu fais confiance
au fichier.

### Sur Mac — « SecondBrain n'a pas pu être vérifié »
1. Ne clique pas sur « Déplacer vers la corbeille ».
2. Va dans le dossier **Applications**, fais un **clic droit** sur **SecondBrain**, puis
   choisis **Ouvrir**.
3. Une nouvelle fenêtre apparaît avec un bouton **Ouvrir** : clique dessus.
4. À partir de là, l'app s'ouvre normalement d'un simple double-clic.

> Si le clic droit → Ouvrir ne propose pas « Ouvrir » : va dans **Réglages Système →
> Confidentialité et sécurité**, descends jusqu'au message qui parle de SecondBrain, et
> clique sur **Ouvrir quand même**.

### Sur Windows — « Windows a protégé votre PC »
1. Clique sur le lien **Informations complémentaires**.
2. Un bouton **Exécuter quand même** apparaît en bas : clique dessus.

---

## 3. Coller ta clé d'accès à l'IA (une seule fois)

Pour que le **chat** et l'**analyse des documents** fonctionnent, l'app a besoin d'une clé.

> ⚠️ **Utilise la clé de la passerelle de l'entreprise** (la clé partagée qu'on t'a
> communiquée). **Ce n'est PAS** une clé à créer soi-même sur console.anthropic.com.

1. Dans l'app, clique sur l'icône **engrenage ⚙️** en bas à gauche (**Réglages**).
2. Choisis le preset **« Passerelle d'entreprise »** (l'adresse et le modèle se remplissent
   tout seuls).
3. **Colle la clé** dans le champ « Clé API ».
4. Clique sur **« Tester la connexion »**. Tu dois voir **« Connexion OK »** en vert.
   - Si c'est rouge : vérifie que tu as bien collé la clé de la **passerelle** (pas une
     clé OpenAI/Google, qui ne fonctionnent pas), et que l'adresse est correcte.
5. Clique sur **« Enregistrer »**. La clé est mémorisée sur ta machine — tu n'auras plus
   à la saisir, même après avoir fermé l'app.

---

## 4. Déposer un document dans ton wiki

1. Clique sur l'icône **Déposer** (la flèche vers le haut ⬆️, dans la barre de gauche).
2. Ajoute ton fichier (PDF, texte…) et ses informations.
3. Lance l'analyse : l'IA lit le document et crée une fiche dans ton wiki.

Tu peux ensuite **discuter** avec ton wiki (icône **Chat**), l'**explorer** (Graphe,
Sources, Thèmes, Entités), et **supprimer** une ressource si besoin.

---

## 5. Mettre à jour l'application

Cette version se met à jour **à la main** (il n'y a pas encore de mise à jour automatique).

1. Quand une nouvelle version t'est partagée, **réinstalle-la** comme au point 1
   (glisse la nouvelle app dans Applications en remplaçant l'ancienne, ou relance le
   nouveau `.exe`).
2. **Tes données ne bougent pas.** Ton wiki, tes documents, ton historique de chat et ta
   clé sont stockés **séparément** de l'application, dans ton dossier personnel :
   - Mac : `~/Library/Application Support/SecondBrain/`
   - Windows : `%APPDATA%\SecondBrain\`
   Remplacer l'application **n'efface jamais** ce dossier.

---

## En cas de souci

- **La fenêtre reste sur « Démarrage… »** : ferme complètement l'app et rouvre-la. Si le
  problème persiste, un fichier de journal est disponible dans le dossier de données
  ci-dessus, sous `.data/server.log`.
- **Le chat affiche « Ajoute ta clé dans les réglages »** : c'est que la clé n'est pas (ou
  plus) enregistrée — refais le point 3.
