import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { io } from 'socket.io-client';
import { Eraser, Pencil, Trash2, MousePointer2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const socket = io('http://localhost:3001');

const Whiteboard = forwardRef((props, ref) => {
  const canvasRef = useRef(null);
  const contextRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#ffffff');
  const [lineWidth, setLineWidth] = useState(3);
  const [isEraser, setIsEraser] = useState(false);
  
  // Track other users' cursors (Locations)
  const [cursors, setCursors] = useState({});
  const lastEmit = useRef(0);
  const prevPos = useRef({ x: 0, y: 0 });

  useImperativeHandle(ref, () => ({
    getCanvas: () => canvasRef.current,
    clear: () => clearCanvas()
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      canvas.width = parent.clientWidth * 2;
      canvas.height = parent.clientHeight * 2;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;
      const context = canvas.getContext('2d');
      context.scale(2, 2);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      contextRef.current = context;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    socket.on('draw', (data) => {
      drawOnCanvas(data.x, data.y, data.prevX, data.prevY, data.color, data.size, data.isEraser);
    });

    socket.on('cursor-move', (data) => {
      setCursors(prev => ({
        ...prev,
        [data.id]: { x: data.x, y: data.y, color: data.color }
      }));
    });

    socket.on('clear', () => {
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
    });

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      socket.off('draw');
      socket.off('cursor-move');
      socket.off('clear');
    };
  }, []);

  useEffect(() => {
    if (contextRef.current) {
      contextRef.current.strokeStyle = isEraser ? '#0f172a' : color;
      contextRef.current.lineWidth = lineWidth;
    }
  }, [color, lineWidth, isEraser]);

  const startDrawing = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    prevPos.current = { x: offsetX, y: offsetY };
    setIsDrawing(true);
  };

  const finishDrawing = () => {
    setIsDrawing(false);
  };

  const draw = ({ nativeEvent }) => {
    const { offsetX, offsetY } = nativeEvent;
    
    // Broadcast cursor position (Live Location)
    const now = Date.now();
    if (now - lastEmit.current > 30) {
      socket.emit('cursor-move', { x: offsetX, y: offsetY, color });
      lastEmit.current = now;
    }

    if (!isDrawing) return;

    const px = prevPos.current.x;
    const py = prevPos.current.y;

    drawOnCanvas(offsetX, offsetY, px, py, color, lineWidth, isEraser);
    
    socket.emit('draw', { 
      x: offsetX, 
      y: offsetY, 
      prevX: px, 
      prevY: py, 
      color: isEraser ? '#0f172a' : color, 
      size: lineWidth,
      isEraser
    });

    prevPos.current = { x: offsetX, y: offsetY };
  };

  const drawOnCanvas = (x, y, px, py, c, s, eraser) => {
    const ctx = contextRef.current;
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = eraser ? '#0f172a' : c;
    ctx.lineWidth = s;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    socket.emit('clear');
  };

  return (
    <div className="relative w-full h-full bg-[#0f172a] overflow-hidden">
      <canvas
        onMouseDown={startDrawing}
        onMouseUp={finishDrawing}
        onMouseMove={draw}
        onMouseOut={finishDrawing}
        ref={canvasRef}
        className="block cursor-none"
      />

      {/* Live Cursors (Locations) Overlay */}
      <AnimatePresence>
        {Object.entries(cursors).map(([id, pos]) => (
          <motion.div
            key={id}
            initial={{ opacity: 0 }}
            animate={{ 
              opacity: 1, 
              x: pos.x, 
              y: pos.y,
              transition: { type: 'spring', damping: 25, stiffness: 200 }
            }}
            className="pointer-events-none absolute top-0 left-0 z-50 flex flex-col items-center"
            style={{ color: pos.color }}
          >
            <MousePointer2 className="w-5 h-5 fill-current stroke-white stroke-[3px]" />
            <div className="bg-slate-800/80 backdrop-blur-md px-1.5 py-0.5 rounded-md border border-white/10 mt-1 shadow-lg">
              <span className="text-[9px] font-bold text-white uppercase tracking-tighter">
                Collaborator {id.slice(0, 3)}
              </span>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Toolbar */}
      <motion.div 
        initial={{ y: 100 }}
        animate={{ y: 0 }}
        className="fixed bottom-8 left-1/2 -translate-x-1/2 glass-panel p-4 flex items-center space-x-6 z-20"
      >
        <div className="flex bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
          <ToolButton 
            active={!isEraser} 
            onClick={() => setIsEraser(false)} 
            icon={<Pencil className="w-5 h-5" />} 
          />
          <ToolButton 
            active={isEraser} 
            onClick={() => setIsEraser(true)} 
            icon={<Eraser className="w-5 h-5" />} 
          />
        </div>

        <div className="h-8 w-[1px] bg-slate-700" />

        <div className="flex items-center space-x-3">
          {['#ffffff', '#6366f1', '#ec4899', '#10b981', '#f59e0b', '#ef4444'].map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-125 ${color === c ? 'border-blue-400' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="h-8 w-[1px] bg-slate-700" />

        <div className="flex items-center space-x-4">
          <input
            type="range"
            min="1"
            max="20"
            value={lineWidth}
            onChange={(e) => setLineWidth(e.target.value)}
            className="w-24 h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <span className="text-xs font-mono text-slate-400 w-4">{lineWidth}</span>
        </div>

        <div className="h-8 w-[1px] bg-slate-700" />

        <button 
          onClick={clearCanvas}
          className="p-2.5 rounded-xl hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors"
          title="Clear Board"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </motion.div>
    </div>
  );
});

function ToolButton({ active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`p-2 rounded-lg transition-all duration-200 ${
        active 
          ? 'bg-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.4)]' 
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'
      }`}
    >
      {icon}
    </button>
  );
}

export default Whiteboard;
