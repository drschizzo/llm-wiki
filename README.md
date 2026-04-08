# LLM-Wiki : Base de Connaissances Intelligente & Graphe Autonome

## Concept du Projet

**LLM-Wiki** est une application innovante conçue pour transformer la gestion documentaire statique (comme les fichiers Markdown ou les notes Obsidian) en un **Graphe de Connaissances dynamique, intelligent et interconnecté**.

En alliant la puissance des Modèles de Langage (LLM - Gemini, modèles locaux via LM Studio) et une interface wiki réactive, ce projet permet non seulement de stocker des informations, mais aussi d'interagir avec elles, de les lier automatiquement et de les structurer intelligemment. 

C'est l'outil parfait pour maintenir une base de connaissances personnelle ou d'entreprise qui s'auto-organise et répond à vos questions directes en se basant sur le contexte de vos propres documents (RAG - Retrieval-Augmented Generation).

## Possibilités et Fonctionnalités

*   **Wiki augmenté par LLM :** Éditeur Markdown riche (`@uiw/react-md-editor`) intégré avec une aide à l'écriture et au formatage.
*   **Assistant Chat Contextuel :** Interrogez votre base de connaissances via un panneau de chat (support multi-lignes, références dynamiques de pages). L'IA utilise vos documents actuels comme contexte pour générer des réponses expertes et précises.
*   **Visualisation par Graphe (Knowledge Graph) :** Explorez vos notes avec une carte visuelle interactive 2D (nœuds et liens) qui modélise explicitement les connexions entre vos idées et vos pages.
*   **Ingestion et Auto-Organisation :** 
    * Importez vos archives Markdown / Obsidian.
    * Le système analyse, extrait des résumés et crée automatiquement des hyperliens croisés robustes entre vos documents.
*   **Maintenance Agentique :** Des agents IA s'assurent de l'intégrité du wiki: nettoyage des liens morts, partitionnement du graphe pour optimiser la fenêtre de contexte LLM, et suggestions de restructuration.
*   **Gestion de Pages intuitive :** Création, édition avancée et suppression de pages. Chaque action synchronise et met à jour instantanément la représentation du graphe sur l'interface.
*   **Navigation Native :** Une expérience Single Page Application (React) qui respecte tout de même l'historique natif de votre navigateur internet (boutons retour / suivant fonctionnels).

## Architecture Technique

Le projet repose sur une pile Full-Stack moderne séparant l'interface, l'intelligence artificielle et la logique backend :

*   **Frontend (Interface Utilisateur) :** 
    * **React 19** propulsé par **Vite** pour un tooling et un build ultra-rapides.
    * **TypeScript** garantissant la sécurité et le typage du code.
    * **Tailwind CSS v4** pour un design fluide, moderne et responsive.
    * `react-force-graph-2d` pour le rendu interactif du Knowledge Graph.
    * `lucide-react` pour une collection d'icônes épurée.
*   **Backend & Serveur Local :** 
    * API et serveur statique monté sous **Node.js** et **Express** (`server.ts`).
    * Interaction avec le système de fichiers local (`fs`) pour gérer les pages `.md` (dossier `data/wiki`).
    * Gestion fluide du pipeline d'ingestion des documents historiques et du traitement de texte (Markdown).
*   **Moteur d'Intelligence Artificielle (LLM) :**
    * Support natif de Google Gemini avec `@google/genai` pour des performances optimales.
    * Flexibilité d'API permettant d'adopter des LLM locaux et privés (ex: **LM Studio**) ajustables facilement depuis vos variables d'environnement.

## Configuration et Lancement

Cette section vous guide pour installer, configurer et démarrer le projet sur votre machine.

### Prérequis
*   **Node.js** (version LTS récente recommandée).
*   Une clé API **Google Gemini** OU une instance serveur **LM Studio** fonctionnelle.

### 1. Installation

Clonez ce dépôt (ou installez-vous dans le dossier de travail), puis installez toutes les dépendances requises par npm :

```bash
npm install
```

### 2. Configuration (`.env`)

Créez un fichier `.env` à la racine de votre projet (vous pouvez vous baser sur un `.env.example` s'il est présent) pour configurer vos clés et endpoints d'IA :

```env
# Renseignez votre clé API Google Gemini
GEMINI_API_KEY="votre-cle-api-gemini-ici"

# Port / URL de l'API locale si vous utilisez LM Studio (Optionnel)
# LM_STUDIO_URL="http://localhost:1234/v1"

# Taille maximale par "Chunk" documentaire lors de l'ingestion (Optionnel)
# CHUNK_SIZE=1000
```

### 3. Démarrage du Serveur

Il ne vous reste plus qu'à lancer l'application en mode développement :

```bash
npm run dev
```

L'application compilera le front-end React avec Vite et lancera le service backend simultanément (`tsx server.ts`). 
*Une fois le serveur en ligne, rendez-vous sur l'URL de localhost spécifiée dans votre terminal (généralement `http://localhost:5173/` ou `http://localhost:3000/`) pour explorer votre wiki.*
