import React from 'react';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-2xl shadow-2xl relative"
          >
            <button 
              onClick={onClose}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
              title="Fermer"
            >
              <X className="w-5 h-5" />
            </button>
            
            <h2 className="text-xl font-semibold text-white mb-6">Guide d'utilisation - LLM Wiki</h2>
            
            <div className="space-y-4 text-zinc-300 text-sm leading-relaxed">
              <p>
                <strong>LLM Wiki</strong> est un outil de gestion de connaissances intelligent qui utilise des modèles de langage pour analyser, structurer et interroger vos documents.
              </p>
              
              <h3 className="text-white font-medium mt-6 mb-2">Fonctionnalités principales</h3>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Ingestion de sources :</strong> Ajoutez du contenu via la barre latérale en fournissant des fichiers ou une URL. Le système générera automatiquement des pages synthétiques.</li>
                <li><strong>Graphe de connaissances :</strong> Visualisez les relations entre vos différentes pages en utilisant la vue graphe (icône globe terrestre).</li>
                <li><strong>Assistant IA :</strong> Utilisez le panneau de discussion pour poser des questions. L'assistant dispose du contexte de votre wiki pour des réponses précises.</li>
                <li><strong>Recherche sémantique :</strong> Retrouvez vos notes rapidement grâce à la barre de recherche en haut de page.</li>
              </ul>
              
              <h3 className="text-white font-medium mt-6 mb-2">Mode d'emploi</h3>
              <ol className="list-decimal pl-5 space-y-2">
                <li>Ingérez une nouvelle source pour peupler la base de connaissances.</li>
                <li>Naviguez dans l'index ou cherchez un terme spécifique pour retrouver la page correspondante.</li>
                <li>Éditez vos pages librement. Le système mettra à jour le graphe de liens.</li>
                <li>Ouvrez l'assistant IA en bas à droite pour interagir avec le contenu de votre wiki.</li>
              </ol>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
