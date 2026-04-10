# LLM-Wiki

Base de connaissances auto-organisée par LLM avec graphe de connaissances interactif.

## Qu'est-ce que c'est ?

LLM-Wiki transforme vos documents (fichiers texte, images, URLs, archives ZIP) en un wiki structuré et interconnecté. Un agent LLM analyse le contenu, crée des pages, et construit automatiquement un graphe de liens entre les concepts.

Contrairement à un wiki classique où vous organisez manuellement, ici le LLM décide de la structure : il crée, fusionne, découpe et relie les pages de manière autonome.

## Fonctionnalités

### Ingestion de documents

- **Fichiers texte** : Markdown, `.txt`, code source — le LLM analyse le contenu et le distribue en pages thématiques
- **Images** : Analyse visuelle (diagrammes, captures d'écran) et création de pages descriptives
- **URLs** : Extraction du contenu web et intégration au wiki
- **Archives ZIP** : Extraction et traitement récursif de tous les fichiers
- **Chunking automatique** : Les documents dépassant `MAX_CHUNK_LENGTH` sont découpés en morceaux avec un mécanisme d'**outline incrémental** pour que le LLM garde le contexte global
- **Déduplication hachée** : Les fichiers déjà ingérés (hash SHA-256) sont automatiquement ignorés
- **Consolidation post-ingestion** : Après chaque fichier, un pass automatique détecte et fusionne les pages quasi-identiques
- **Provenance** : Chaque page créée reçoit un lien vers le fichier source original

### Agent wiki autonome

L'agent LLM dispose des opérations suivantes, disponibles aussi bien en ingestion qu'en chat :

| Opération | Description |
|---|---|
| `wikiUpdates` | Créer ou modifier des pages (modes `append` / `replace`) |
| `deletePages` | Supprimer des pages obsolètes (nettoyage automatique des liens morts) |
| `mergePages` | Fusionner deux pages sur le même sujet (redirection des liens) |
| `splitPage` | Découper une page trop grande en sous-pages avec hub/TOC |
| `exploreGraph` | Explorer les voisins d'un nœud du graphe |
| `readPages` | Lire le contenu complet de pages existantes |

L'agent utilise une **boucle agentic** (jusqu'à 4 itérations) : il peut explorer le graphe et lire des pages avant de décider quelles modifications apporter.

### Chat contextuel

- Interrogez votre base via un panneau de chat intégré
- L'agent peut lire, créer et modifier des pages pendant la conversation
- Support multi-lignes (`Shift+Enter`)
- Bouton "Référencer la page" pour injecter le contexte de la page courante
- Chaque conversation est sauvegardée comme source (traçabilité)

### Knowledge Graph interactif

- Visualisation 2D interactive des pages et de leurs connexions (`react-force-graph-2d`)
- **Clusters** : Regroupement visuel de pages par thème avec palette de couleurs
- Gestion des liens : création et suppression via l'API
- Filtrage automatique des pages système (index, log)

### Édition de pages

- Éditeur Markdown intégré (`@uiw/react-md-editor`)
- Création, édition et suppression de pages
- Recherche full-text sur l'ensemble du wiki
- Index auto-généré alphabétiquement à partir du graphe

### Administration

- Nettoyage des liens morts (`POST /api/admin/clean-links`)
- Fusion manuelle de pages (`POST /api/admin/merge`)
- Découpage manuel de pages (`POST /api/admin/split`)
- Système de backup automatique avant opérations destructives (`data/backups/`)

## Architecture

```
llm-wiki/
├── server/
│   ├── index.ts              # Point d'entrée Express + Vite middleware
│   ├── config.ts             # Configuration, prompts et WIKI_TOOLS_SPEC partagé
│   ├── types.ts              # Types TypeScript (WikiGraph)
│   ├── routes/
│   │   ├── chat.routes.ts    # Chat agentic avec boucle explore/read/act
│   │   ├── ingest.routes.ts  # Ingestion fichiers/URL/images + consolidation
│   │   ├── wiki.routes.ts    # CRUD pages + recherche
│   │   ├── graph.routes.ts   # API graphe + gestion des liens
│   │   ├── cluster.routes.ts # CRUD clusters visuels
│   │   └── admin.routes.ts   # Outils d'administration (clean/merge/split)
│   └── services/
│       ├── llm.service.ts    # Abstraction multi-provider (Gemini, LM Studio, Ollama)
│       ├── graph.service.ts  # Construction du graphe + snippets + index auto
│       ├── wiki.service.ts   # Opérations wiki (CRUD, merge, split, delete, backup)
│       └── cluster.service.ts # Gestion des clusters visuels
├── client/                   # Frontend React 19
├── data/
│   ├── wiki/                 # Pages markdown du wiki
│   ├── raw/                  # Fichiers sources originaux
│   ├── backups/              # Backups automatiques avant opérations destructives
│   ├── graph.json            # Graphe de connaissances sérialisé
│   └── processed_hashes.json # Hashes des fichiers déjà ingérés
└── .env                      # Configuration des providers LLM
```

## Providers LLM supportés

| Provider | Usage | Configuration |
|---|---|---|
| **Google Gemini** | Cloud, haute capacité | `GEMINI_API_KEY` |
| **LM Studio** | Local, compatible OpenAI | `LMSTUDIO_API_URL` |
| **Ollama** | Local, open-source | `LMSTUDIO_API_URL` + `LOCAL_MODEL_NAME` |

## Installation

### Prérequis

- **Node.js** v18+
- Une clé API Gemini **ou** une instance LM Studio / Ollama locale

### Setup

```bash
# Cloner et installer
git clone <repo-url>
cd llm-wiki
npm install

# Configurer
cp .env.example .env
# Éditer .env avec votre clé API / URL locale
```

### Configuration `.env`

```env
# Google Gemini (requis si provider = gemini)
GEMINI_API_KEY="votre-clé"

# LM Studio ou Ollama (optionnel)
LMSTUDIO_API_URL="http://localhost:1234/v1/chat/completions"
LOCAL_MODEL_NAME="local-model"

# Taille max d'un chunk avant découpage automatique (défaut: 30000 caractères)
MAX_CHUNK_LENGTH="30000"
```

### Lancement

```bash
npm run dev
```

Le serveur démarre sur `http://localhost:3000` (backend + frontend Vite en mode dev).

## API

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/chat` | Chat avec l'agent wiki |
| `POST` | `/api/ingest/files` | Ingestion de fichiers (multipart) |
| `POST` | `/api/ingest/url` | Ingestion d'une URL |
| `GET` | `/api/wiki` | Liste des pages |
| `GET` | `/api/wiki/:id` | Contenu d'une page |
| `POST` | `/api/wiki/:id` | Créer/modifier une page |
| `DELETE` | `/api/wiki/:id` | Supprimer une page |
| `GET` | `/api/graph` | Graphe complet (nœuds + liens + clusters) |
| `POST` | `/api/graph/link` | Créer un lien entre deux pages |
| `DELETE` | `/api/graph/link` | Supprimer un lien |
| `GET` | `/api/search?q=` | Recherche full-text |
| `GET/POST/PUT/DELETE` | `/api/clusters` | CRUD clusters |
| `POST` | `/api/admin/clean-links` | Nettoyer les liens morts |
| `POST` | `/api/admin/merge` | Fusionner deux pages |
| `POST` | `/api/admin/split` | Découper une page |
| `GET` | `/raw/:filename` | Accès aux fichiers sources originaux |
