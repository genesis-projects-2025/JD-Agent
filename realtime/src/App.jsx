import React, { useState, useRef } from 'react';
import Auth from './components/Auth';
import Whiteboard from './components/Whiteboard';
import AIClassifier from './components/AIClassifier';
import Chat from './components/Chat';
import { motion, AnimatePresence } from 'framer-motion';
import { LogOut, Layers, Users } from 'lucide-react';

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const whiteboardRef = useRef(null);

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  return (
    <div className="bg-[#0f172a] h-screen w-screen overflow-hidden">
      <AnimatePresence mode="wait">
        {!isAuthenticated ? (
          <motion.div
            key="login"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <Auth onLogin={setIsAuthenticated} />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col h-full"
          >
            {/* Header / Sidebar alternative */}
            <div className="fixed top-8 left-8 flex items-center space-x-6 z-30">
              <div className="flex items-center space-x-3 glass-panel px-4 py-2 border-indigo-500/20 shadow-lg">
                <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-white" />
                </div>
                <span className="font-bold text-white tracking-tight">CollabBoard v1.0</span>
              </div>

              <div className="flex items-center space-x-2 glass-panel px-4 py-2 border-slate-700/50">
                <Users className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-medium text-slate-300">3 Online</span>
              </div>
            </div>

            <button 
              onClick={handleLogout}
              className="fixed bottom-8 right-8 p-3.5 rounded-2xl glass-panel text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all z-30 group"
            >
              <LogOut className="w-6 h-6 group-hover:rotate-180 transition-transform duration-500" />
            </button>

            {/* Whiteboard and AI Vision */}
            <Whiteboard ref={whiteboardRef} />
            <AIClassifier canvasRef={whiteboardRef} />
            <Chat />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
