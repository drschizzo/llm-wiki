# LLM-Wiki : Base de Connaissances Intelligente & Graphe Autonome

## Concept du Projet

**LLM-Wiki** est une application innovante conçue pour transformer la gestion documentaire statique (comme les fichiers Markdown ou les notes Obsidian) en un **Graphe de Connaissances dynamique, intelligent et interconnecté**.

En alliant la puissance des Modèles de Langage (LLM - Gemini, modèles locaux via LM Studio ou Ollama) et une interface wiki réactive, ce projet permet non seulement de stocker des informations, mais aussi d'interagir avec elles, de les lier automatiquement et de les structurer intelligemment. 

C'est l'outil parfait pour maintenir une base de connaissances personnelle ou d'entreprise qui s'auto-organise et répond à vos questions directes en se basant sur le contexte de vos propres documents (RAG - Retrieval-Augmented Generation).

## Possibilités et Fonctionnalités

*   **Wiki augmenté par LLM :** Éditeur Markdown riche (`@uiw/react-md-editor`) intégré avec une aide à l'écriture et au formatage.
*   **Traçabilité et Provenance des Données (Data Provenance) :** Le système sauvegarde la source originale lors de l'ingestion de vos documents. Chaque page du wiki dispose d'un lien vous permettant de consulter sa source (qu'il s'agisse d'un fichier importé ou de la conversation de chat précise ayant déclenché sa création).
*   **Assistant Chat Avancé :** Interrogez votre base de connaissances via un panneau de chat avec support multi-lignes (raccourci `Shift+Enter`). Initiez de nouvelles conversations à la volée et injectez facilement la page wiki courante en tant que référence de contexte pour le LLM.
*   **Visualisation par Graphe (Knowledge Graph) :** Explorez vos notes avec une carte visuelle interactive 2D (nœuds et liens) qui modélise explicitement les connexions entre vos idées. Le graphe filtre désormais astucieusement les documents de système (index, logs) pour un focus absolu sur les données pertinentes.
*   **Ingestion Automatisée de Cerveaux Numériques :** 
    * Importez massivement et consolidez vos archives fragmentées (telles que des bases Obsidian).
    * Le système analyse, extrait des résumés et crée automatiquement des hyperliens croisés efficients entre vos concepts pour unifier vos données.
*   **Agence Autonome Moteur :** Des agents proactifs basés sur l'IA interviennent sur l'intégrité applicative. Ils se chargent d'exploiter les graphes partitionnés, de construire une documentation croisée autonome et d'évoluer en assurant des résultats cohérents sous la contrainte critique des limitations de tokens.
*   **Gestion de Pages intuitive :** Création, édition avancée et **suppression** de pages. Chaque action synchronise instantanément et sans effort la représentation du graphe sur le frontend.
*   **Navigation Transparente :** Une Single Page Application (React) couplée à un respect de l'historique natif de navigation web (PushState / PopState localisé), dotée d'une doc modal d'aide d'interface discrète et claire.

## Architecture Technique

Le projet repose sur une pile Full-Stack moderne, structurée et modulaire (déployant front, intelligence artificielle et une architecture backend évolutive et testable) :

*   **Frontend (Interface Utilisateur) :** 
    * **React 19** propulsé par **Vite** pour un tooling et un build ultra-rapides, sur une architecture de composants fine spécialisée (Modales d'ingestion, Chat contextuel séparé, Graphe, etc).
    * **TypeScript** garantissant la sécurité et le typage du code.
    * **Tailwind CSS v4** pour un design fluide, moderne et responsive.
    * `react-force-graph-2d` pour le rendu interactif du Knowledge Graph.
*   **Backend & Serveur Local :** 
    * API Express découplée : le point d'entrée modulaire (`server/index.ts`) distribue les micro-services clés (LLM, Graph, Wiki), la configuration centralisée et le routage métier (API Routes).
    * Accès robuste au système de fichiers local (`fs`) gérant d'un côté la production (`data/wiki`) et de l'autre la pérennité du lineage de contenu original de vos bases ingérées.
*   **Moteur d'Intelligence Artificielle (LLM) :**
    * Support natif de Google Gemini avec `@google/genai` pour des performances et capacités d'instruction remarquables.
    * Flexibilité modulaire permettant d'adopter des LLM locaux et alternatifs tels que **LM Studio** et **Ollama**, aisément déclarés depuis vos variables d'environnement.

## Configuration et Lancement

Cette section vous guide pour installer, configurer et démarrer le projet sur votre machine.

### Prérequis
*   **Node.js** (version LTS récente recommandée).
*   Une clé API **Google Gemini** OU une instance serveur **LM Studio / Ollama** fonctionnelle.

### 1. Installation

Clonez ce dépôt, puis installez toutes les dépendances requises par le gestionnaire système :

```bash
npm install
```

### 2. Configuration (`.env`)

Basez-vous sur l'exemple de configuration embarqué en copiant le `.env.example` en `.env` :

```bash
cp .env.example .env
```

Ouvrez puis complétez vos clés et endpoints locaux ciblés :

```env
# Renseignez votre clé API Google Gemini
GEMINI_API_KEY="votre-cle-api-gemini-ici"

# Port / URL de l'API locale si vous utilisez LM Studio / Ollama (Optionnel)
# (Laissez vide ou commentez si vous souhaitez vous appuyer sur le provider par défaut)
LM_STUDIO_URL="http://localhost:1234/v1"
```

### 3. Démarrage du Serveur

Il ne vous reste plus qu'à lancer le système unifié par son script de lacement développement :

```bash
npm run dev
```

L'application compilera le front-end React avec Vite et lancera le service backend simultanément (`tsx server/index.ts`). 
*Une fois le serveur en ligne et l'API validée, rendez-vous sur l'URL locale indiquée dans le récapitulatif du terminal (ex: `http://localhost:5173/`) pour explorer et déployer votre graphe.*
