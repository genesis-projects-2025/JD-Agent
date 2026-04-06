import React, { useState, useEffect } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { BrainCircuit, Loader2, Sparkles, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AIClassifier({ canvasRef }) {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [classifying, setClassifying] = useState(false);
  const [predictions, setPredictions] = useState([]);

  useEffect(() => {
    async function loadModel() {
      try {
        const net = await mobilenet.load();
        setModel(net);
        setLoading(false);
      } catch (err) {
        console.error('Failed to load TF model:', err);
      }
    }
    loadModel();
  }, []);

  const classifyImage = async () => {
    if (!model || !canvasRef.current) return;
    
    setClassifying(true);
    try {
      const canvas = canvasRef.current.getCanvas();
      const predictions = await model.classify(canvas);
      setPredictions(predictions);
    } catch (err) {
      console.error('Classification error:', err);
    } finally {
      setClassifying(false);
    }
  };

  return (
    <div className="fixed top-8 right-8 w-80 z-30">
      <motion.div 
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="glass-panel p-6 shadow-2xl relative"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center border border-indigo-400/20">
              <BrainCircuit className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h3 className="font-bold text-white leading-tight">AI Vision</h3>
              <p className="text-[10px] text-indigo-400 font-mono">MOBILENET_V2</p>
            </div>
          </div>
          {loading ? (
            <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
          )}
        </div>

        <button
          onClick={classifyImage}
          disabled={loading || classifying}
          className="w-full btn-primary mb-6 flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed group relative overflow-hidden"
        >
          {classifying ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <span>Identify Sketch</span>
              <TrendingUp className="w-4 h-4 group-hover:translate-x-1" />
            </>
          )}
        </button>

        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {predictions.length > 0 ? (
              predictions.map((p, i) => (
                <motion.div 
                  key={p.className}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-slate-800/40 border border-slate-700/50 p-3 rounded-xl"
                >
                  <div className="flex justify-between items-center mb-1.5">
                    <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider truncate w-40">
                      {p.className.split(',')[0]}
                    </span>
                    <span className="text-[10px] font-mono text-indigo-400 bg-indigo-500/10 px-1.5 py-0.5 rounded">
                      {(p.probability * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-700/50 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${p.probability * 100}%` }}
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full"
                    />
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-slate-500 italic">No predictions yet. Draw something and click classify!</p>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Decorative corner */}
        <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-indigo-500/50 rounded-tr-md" />
      </motion.div>
    </div>
  );
}
