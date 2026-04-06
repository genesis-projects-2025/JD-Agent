import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { Send, MessageSquare, User, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const socket = io('http://localhost:3001');

export default function Chat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    socket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, { ...msg, type: 'remote' }]);
    });

    return () => socket.off('chat-message');
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const msgData = {
      text: input,
      time: new Date().toLocaleTimeString([], { hour: '2-numeric', minute: '2-numeric' }),
      user: 'Admin' // Simplifying for now
    };

    socket.emit('chat-message', msgData);
    setMessages((prev) => [...prev, { ...msgData, type: 'local' }]);
    setInput('');
  };

  return (
    <div className="fixed bottom-8 left-8 z-40">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="glass-panel w-80 h-[450px] mb-4 flex flex-col shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-indigo-500/10">
              <div className="flex items-center space-x-2">
                <MessageSquare className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">Team Chat</h3>
              </div>
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-emerald-400 font-mono uppercase">Live</span>
              </div>
            </div>

            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
            >
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center opacity-30">
                  <MessageSquare className="w-12 h-12 mb-2" />
                  <p className="text-xs">No messages yet</p>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: msg.type === 'local' ? 10 : -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex flex-col ${msg.type === 'local' ? 'items-end' : 'items-start'}`}
                  >
                    <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                      msg.type === 'local' 
                        ? 'bg-indigo-600 text-white rounded-tr-none shadow-lg' 
                        : 'bg-slate-800 text-slate-200 rounded-tl-none border border-white/5'
                    }`}>
                      {msg.text}
                    </div>
                    <span className="text-[10px] text-slate-500 mt-1 flex items-center">
                      <Clock className="w-3 h-3 mr-1" /> {msg.time}
                    </span>
                  </motion.div>
                ))
              )}
            </div>

            <form onSubmit={sendMessage} className="p-4 bg-white/5 border-t border-white/10">
              <div className="relative">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type a message..."
                  className="glass-input w-full pr-10 text-sm h-10"
                />
                <button 
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`p-4 rounded-2xl shadow-2xl transition-all duration-300 flex items-center space-x-2 ${
          isOpen ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'btn-primary'
        }`}
      >
        <MessageSquare className="w-6 h-6" />
        <span className="font-bold text-sm">{isOpen ? 'Close Chat' : 'Messages'}</span>
        {!isOpen && messages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] rounded-full flex items-center justify-center font-bold">
            {messages.length}
          </span>
        )}
      </button>
    </div>
  );
}
