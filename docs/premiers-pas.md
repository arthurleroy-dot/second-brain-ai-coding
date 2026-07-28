# Premiers pas — installer et lancer Second Brain

Bienvenue 👋 Ce guide explique, en 4 étapes, comment installer l'application
**Second Brain** sur ton ordinateur, la lancer la première fois, brancher l'accès
à l'IA, et où retrouver tes données. Aucune compétence technique requise.

> **En un mot :** Second Brain est une application de bureau qui tourne
> **entièrement sur ta machine**. Il n'y a pas de compte à créer, pas de serveur
> distant. Tout ce que tu ajoutes reste chez toi.

---

## 1. Installer l'application

Tu as reçu un fichier d'installation (via un Drive partagé). Prends celui qui
correspond à ton ordinateur.

### Sur Mac (puces Apple M1/M2/M3…)

1. Double-clique le fichier **`SecondBrain-….dmg`**.
2. Une fenêtre s'ouvre : **glisse l'icône `SecondBrain` sur le dossier
   `Applications`**.
3. C'est installé. Tu peux éjecter le `.dmg` et lancer l'app depuis le Launchpad
   ou le dossier Applications.

### Sur Windows

1. Double-clique le fichier **`SecondBrain-….exe`**.
2. L'installeur se lance et pose l'application ; suis les étapes (Suivant →
   Installer).
3. Un raccourci `SecondBrain` apparaît dans le menu Démarrer.

---

## 2. Autoriser l'app au premier lancement

L'application n'est **pas signée** par un certificat payant Apple/Microsoft (choix
assumé pour cette version). Ton système va donc afficher une alerte de sécurité au
**tout premier lancement**. C'est normal — voici comment passer outre. Tu ne le
feras qu'**une seule fois**.

### Sur Mac

1. Dans le dossier **Applications**, fais un **clic droit** (ou Ctrl + clic) sur
   **`SecondBrain`**.
2. Choisis **« Ouvrir »** dans le menu.
3. Une alerte apparaît (« … n'a pas pu être vérifié ») avec un bouton
   **« Ouvrir »** : clique-le.
4. L'app démarre. Les fois suivantes, un simple double-clic suffit.

> Si le menu clic droit ne propose pas « Ouvrir » : va dans **Réglages Système →
> Confidentialité et sécurité**, descends jusqu'au message concernant SecondBrain,
> et clique **« Ouvrir quand même »**.

### Sur Windows

1. Au lancement, l'écran bleu **« Windows a protégé votre ordinateur »**
   (SmartScreen) peut apparaître.
2. Clique **« Informations complémentaires »**.
3. Puis clique **« Exécuter quand même »**.
4. L'app démarre. Les fois suivantes, plus d'alerte.

---

## 3. Renseigner l'accès à l'IA

Sans clé, tu peux déjà **lire** le wiki, mais le **chat** et l'**ingestion** de
nouvelles sources sont désactivés. Pour les activer, il faut fournir une clé
d'accès à Claude (l'IA d'Anthropic).

1. Dans l'application, ouvre l'écran **Réglages** (route **`/reglages`** dans le
   menu).
2. Choisis l'un des deux modes :
   - **Anthropic (perso/entreprise)** — tu as une clé Anthropic directe. Colle-la
     dans **« Clé API »** et **laisse « Adresse du service » vide** (l'app parle
     alors directement à `api.anthropic.com`).
   - **Passerelle d'entreprise** — tu passes par une passerelle compatible
     Anthropic (ex. la passerelle interne). Colle **ta clé de passerelle** dans
     **« Clé API »**, et renseigne l'**« Adresse du service »** avec l'URL de la
     passerelle (ex. `https://llm-gateway.m33.tech`).
3. **« Modèle »** : tu peux laisser la valeur par défaut (`claude-sonnet-4-5`).
4. Clique **« Tester la connexion »** pour vérifier (message « Connexion OK »),
   puis **« Enregistrer »**.

> ⚠️ Une clé/URL **OpenAI ou Gemini ne fonctionne pas** — l'app parle uniquement le
> protocole d'Anthropic.

La clé est **prise en compte immédiatement** (pas besoin de redémarrer l'app) et
**stockée uniquement sur ta machine** (voir l'étape 4). L'écran ne réaffiche jamais
la clé en clair.

---

## 4. Où sont mes données ?

Toutes tes données vivent dans **un seul dossier visible** de ton dossier
personnel, créé automatiquement au premier lancement :

- **Mac :** `/Users/<ton-nom>/second-brain`
- **Windows :** `C:\Users\<ton-nom>\second-brain`

Il contient :

```
second-brain/
  ├─ wiki/     ← les fiches du wiki (le contenu que tu consultes)
  ├─ raw/      ← les sources d'origine (PDF, notes… déposées)
  └─ .data/    ← ta clé IA, ton historique de chat, les journaux techniques
```

**Ce dossier ne quitte jamais ton ordinateur.** Rien n'est envoyé sur GitHub ni sur
un serveur : ni tes sources, ni tes fiches, ni ta clé, ni tes conversations. Tu peux
ouvrir ce dossier dans le Finder (Mac) ou l'Explorateur (Windows) pour le
sauvegarder ou le copier toi-même si tu le souhaites.

> **« Local » ne veut pas dire « caché ».** On a choisi un dossier bien visible
> pour que tu puisses le retrouver et le sauvegarder facilement. La confidentialité
> ne vient pas du fait qu'il soit caché, mais du fait que **rien ne sort de ta
> machine**.

### Bon à savoir

- **Chaque personne a sa propre copie.** Le contenu livré avec l'app est un
  « instantané » figé au moment de la fabrication. Les ajouts que tu fais restent
  chez toi ; ils ne se propagent pas aux autres, et inversement.
- **Mises à jour de l'app :** pour installer une nouvelle version, on te
  redonnera un nouveau fichier `.dmg`/`.exe` à réinstaller par-dessus. **Tes
  données dans `second-brain/` sont préservées** (une réinstallation ne les écrase
  jamais).
- **Migration depuis une version antérieure :** si tu avais déjà une version plus
  ancienne (< 0.2.0), l'app rapatrie automatiquement tes anciennes données vers le
  nouveau dossier `second-brain/` au premier lancement, sans rien supprimer.

---

Un souci au lancement ? Le journal technique se trouve dans
`second-brain/.data/server.log` — utile à partager si tu demandes de l'aide.
