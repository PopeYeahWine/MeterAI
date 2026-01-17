# Claude Usage Tracker

Widget Windows flottant pour suivre votre consommation Claude AI en temps réel.

![Preview](docs/preview.png)

## Fonctionnalités

- **Widget always-on-top** : Barre flottante discrète et déplaçable
- **Suivi en temps réel** : Pourcentage d'utilisation, requêtes restantes
- **Compte à rebours** : Temps restant avant reset du quota
- **Notifications Windows** : Alertes à 70%, 90%, 100% (configurable)
- **System Tray** : Minimisation dans la zone de notification
- **Historique** : Dernières périodes d'utilisation
- **Persistance** : Les données sont sauvegardées localement

## Installation

### Prérequis

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (pour compiler Tauri)
- Windows 10/11

### Installation rapide

```bash
# Cloner ou copier le projet
cd claude-usage-tracker

# Installer les dépendances
npm install

# Lancer en mode développement
npm run tauri:dev
```

### Créer l'exécutable

```bash
npm run tauri:build
```

L'exécutable sera dans `src-tauri/target/release/claude-usage-tracker.exe`

## Utilisation

### Comptage manuel (Estimation simple)

Puisque vous avez choisi l'approche "estimation simple", vous devez incrémenter le compteur manuellement :

1. **+1 Requête** : Cliquez après chaque appel API Claude
2. **+5** : Pour des opérations multiples
3. **Reset** : Réinitialiser manuellement si besoin

### Raccourcis System Tray

Clic droit sur l'icône dans la barre des tâches :
- **Afficher** : Réaffiche le widget
- **+1 / +5 Requêtes** : Incrémenter rapidement
- **Reset quota** : Réinitialiser
- **Quitter** : Fermer l'application

### Configuration

Cliquez sur ⚙️ dans le widget pour configurer :
- **Limite par période** : Nombre max de requêtes (défaut: 100)
- **Période de reset** : Intervalle en heures (défaut: 4h)
- **Seuils d'alertes** : Pourcentages pour les notifications

## Structure du projet

```
claude-usage-tracker/
├── src/                    # Frontend React
│   ├── App.tsx             # Composant principal
│   ├── main.tsx            # Point d'entrée
│   └── styles.css          # Styles
├── src-tauri/              # Backend Rust
│   ├── src/main.rs         # Logique principale
│   ├── tauri.conf.json     # Configuration Tauri
│   └── icons/              # Icônes
├── package.json
└── README.md
```

## Données persistantes

Les données sont stockées dans :
```
%LOCALAPPDATA%\claude-usage-tracker\data.json
```

## Évolutions possibles

### Comptage automatique (recommandé pour le futur)

Pour un comptage automatique, vous pourriez :

1. **Proxy local** : Intercepter vos requêtes API
2. **Extension navigateur** : Si vous utilisez l'interface web Claude
3. **Wrapper SDK** : Modifier vos appels API pour notifier le widget

Exemple de wrapper Python :
```python
import requests

TRACKER_URL = "http://localhost:8765/add"

def call_claude_api(prompt):
    response = claude_client.messages.create(...)
    # Notifier le tracker
    requests.post(TRACKER_URL, json={"count": 1})
    return response
```

## Dépannage

### Le widget ne démarre pas
- Vérifiez que Rust est installé : `rustc --version`
- Réinstallez les dépendances : `npm install`

### Pas de notifications
- Vérifiez les paramètres de notifications Windows
- Autorisez l'application dans les paramètres de confidentialité

### Icône manquante dans le tray
- Créez les fichiers d'icônes (voir section ci-dessous)

## Générer les icônes

Pour générer les icônes à partir du SVG :

```bash
# Avec ImageMagick
magick convert src-tauri/icons/icon.svg -resize 32x32 src-tauri/icons/32x32.png
magick convert src-tauri/icons/icon.svg -resize 128x128 src-tauri/icons/128x128.png
magick convert src-tauri/icons/icon.svg -resize 256x256 src-tauri/icons/128x128@2x.png
magick convert src-tauri/icons/icon.svg -resize 256x256 src-tauri/icons/icon.ico
```

Ou utilisez un convertisseur en ligne SVG → ICO/PNG.

## Licence

MIT
