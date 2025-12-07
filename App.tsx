import React, { useState, useEffect, useRef } from 'react';
import { AppState, UserLocation, UserPhoto, Message, Product } from './types';
import { Send, MapPin, Camera, Mic, Upload, User, ShoppingBag, Sparkles, AlertCircle } from 'lucide-react';
import { stylistService } from './services/geminiService';
import VoiceMode from './components/VoiceMode';
import { ProductCard } from './components/ProductCard';
import ReactMarkdown from 'react-markdown';
import { Chat } from '@google/genai';

function App() {
  // State
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [location, setLocation] = useState<UserLocation>({ city: '', country: '' });
  const [photos, setPhotos] = useState<UserPhoto[]>([]);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isVoiceModeOpen, setIsVoiceModeOpen] = useState(false);
  const [chatSession, setChatSession] = useState<Chat | null>(null);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize Chat when Location is set
  const handleLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (location.city && location.country) {
      setAppState(AppState.MAIN);
      setIsLoading(true);
      try {
        const chat = await stylistService.createChat(location);
        setChatSession(chat);
        
        // Initial Greeting
        // Fixed: sendMessage expects an object { message: string }
        const result = await chat.sendMessage({ message: "Hello, I'm ready to start. Please introduce yourself briefly." });
        const text = result.text;
        setMessages([{ id: 'init', role: 'model', text }]);
      } catch (err) {
        console.error(err);
        setMessages([{ id: 'err', role: 'model', text: "Welcome. I'm having trouble connecting to the network, but I'm here to help." }]);
      } finally {
        setIsLoading(false);
      }
    }
  };

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        const newPhoto: UserPhoto = {
          id: Date.now().toString(),
          data: base64,
          timestamp: Date.now()
        };
        setPhotos(prev => [...prev, newPhoto]);
        if (!activePhotoId) setActivePhotoId(newPhoto.id);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle Text Chat
  const handleSendMessage = async () => {
    if (!inputText.trim() || !chatSession) return;
    
    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    try {
      // Fixed: sendMessage expects an object { message: string }
      const result = await chatSession.sendMessage({ message: inputText });
      const text = result.text;
      
      const functionCalls = result.functionCalls;
      let recommendedProducts: Product[] | undefined = undefined;

      if (functionCalls && functionCalls.length > 0) {
        // Find displayProducts
        const call = functionCalls.find(fc => fc.name === 'displayProducts');
        if (call) {
           recommendedProducts = (call.args as any).products;
           
           // We must send a tool response back to continue conversation context properly
           // Use sendMessage with functionResponse part as submitFunctionResponse does not exist on Chat
           await chatSession.sendMessage({
             message: [{
               functionResponse: {
                 id: call.id,
                 name: call.name,
                 response: { result: "Products displayed to user." }
               }
             }] as any
           });
        }
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: text, // The model usually summarizes what it found
        products: recommendedProducts
      }]);

    } catch (error) {
      console.error("Chat Error", error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "I apologize, I'm having trouble processing that right now." }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Try On
  const handleTryOn = async (product: Product) => {
    const activePhoto = photos.find(p => p.id === activePhotoId);
    if (!activePhoto) {
      alert("Please upload a photo of yourself first!");
      return;
    }

    // Add a system message indicating processing
    const processingMsgId = Date.now().toString();
    setMessages(prev => [...prev, {
      id: processingMsgId,
      role: 'model',
      text: `Designing your look with the ${product.name}...`,
      isStreaming: true
    }]);

    try {
      const generatedImage = await stylistService.generateTryOn(activePhoto.data, `${product.description} ${product.category || 'outfit'}`);
      
      // Update the message with the image
      setMessages(prev => prev.map(m => {
        if (m.id === processingMsgId) {
          return {
            ...m,
            text: `Here is how the ${product.brand} ${product.name} looks on you.`,
            image: generatedImage,
            isStreaming: false
          };
        }
        return m;
      }));
    } catch (err) {
      console.error(err);
      setMessages(prev => prev.map(m => {
        if (m.id === processingMsgId) {
          return { ...m, text: "I couldn't generate the try-on image at this moment. Please try again.", isStreaming: false };
        }
        return m;
      }));
    }
  };

  // Handle Products from Voice Mode
  const handleVoiceProducts = (products: Product[]) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      role: 'model',
      text: "Here are the items we discussed.",
      products: products
    }]);
  };

  // SETUP SCREEN
  if (appState === AppState.SETUP) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background Accents */}
        <div className="absolute top-0 left-0 w-full h-full opacity-20 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-lux-gold rounded-full filter blur-[128px]"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-900 rounded-full filter blur-[128px]"></div>
        </div>

        <div className="max-w-md w-full bg-lux-dark border border-lux-gray p-8 rounded-2xl shadow-2xl z-10">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-serif text-lux-gold mb-2">Lumière</h1>
            <p className="text-gray-400 text-sm tracking-wide uppercase">Virtual Stylist • Global Trends</p>
          </div>
          
          <form onSubmit={handleLocationSubmit} className="space-y-6">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">City</label>
              <input 
                type="text" 
                required
                className="w-full bg-black border border-lux-gray text-white p-3 rounded focus:border-lux-gold focus:outline-none transition-colors"
                placeholder="e.g. Paris, New York, Tokyo"
                value={location.city}
                onChange={e => setLocation({...location, city: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Country</label>
              <input 
                type="text" 
                required
                className="w-full bg-black border border-lux-gray text-white p-3 rounded focus:border-lux-gold focus:outline-none transition-colors"
                placeholder="e.g. France"
                value={location.country}
                onChange={e => setLocation({...location, country: e.target.value})}
              />
            </div>
            <button 
              type="submit"
              className="w-full bg-white text-black font-bold py-3 rounded hover:bg-lux-gold hover:text-white transition-all duration-300"
            >
              Enter Atelier
            </button>
          </form>
        </div>
      </div>
    );
  }

  // MAIN SCREEN
  return (
    <div className="flex h-screen bg-black text-gray-200 overflow-hidden">
      {/* Sidebar: Profile & Photos */}
      <div className="w-80 bg-lux-dark border-r border-lux-gray flex flex-col hidden md:flex">
        <div className="p-6 border-b border-lux-gray">
          <h2 className="font-serif text-xl text-white mb-1">My Wardrobe</h2>
          <div className="flex items-center text-xs text-lux-gold gap-1">
            <MapPin size={12} />
            {location.city}, {location.country}
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase">My Photos</span>
              <button 
                onClick={() => fileInputRef.current?.click()}
                className="text-xs flex items-center gap-1 text-lux-gold hover:text-white transition-colors"
              >
                <Upload size={12} /> Upload
              </button>
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept="image/*"
                onChange={handlePhotoUpload}
              />
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {photos.map(photo => (
                <div 
                  key={photo.id}
                  onClick={() => setActivePhotoId(photo.id)}
                  className={`aspect-[3/4] rounded-lg overflow-hidden cursor-pointer border-2 transition-all ${activePhotoId === photo.id ? 'border-lux-gold ring-2 ring-lux-gold/20' : 'border-transparent hover:border-gray-600'}`}
                >
                  <img src={photo.data} alt="User" className="w-full h-full object-cover" />
                </div>
              ))}
              {photos.length === 0 && (
                <div className="col-span-2 border border-dashed border-gray-700 rounded-lg aspect-video flex flex-col items-center justify-center text-gray-600 text-sm">
                  <User size={24} className="mb-2" />
                  <p>Upload a full-body photo<br/>for virtual try-on</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* User Status Footer */}
        <div className="p-4 border-t border-lux-gray bg-black/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-lux-gold to-yellow-200 flex items-center justify-center text-black font-bold">
              {location.city[0]}
            </div>
            <div>
              <p className="text-sm font-medium text-white">VIP Member</p>
              <p className="text-xs text-gray-500">Active Now</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col relative">
        {/* Header */}
        <div className="h-16 border-b border-lux-gray flex items-center justify-between px-6 bg-lux-dark/80 backdrop-blur z-10">
          <h1 className="font-serif text-2xl tracking-tight text-white">Lumière <span className="text-lux-gold text-base italic">AI</span></h1>
          <button 
            onClick={() => setIsVoiceModeOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-lux-gray hover:bg-lux-gold hover:text-white transition-all text-sm font-medium"
          >
            <Mic size={16} />
            Voice Mode
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-3xl w-full ${msg.role === 'user' ? 'flex justify-end' : ''}`}>
                {msg.role === 'model' && (
                  <div className="flex gap-4">
                    <div className="w-8 h-8 rounded-full bg-lux-gold flex-shrink-0 flex items-center justify-center">
                      <Sparkles size={16} className="text-black" />
                    </div>
                    <div className="space-y-4 w-full">
                      {msg.text && (
                        <div className="prose prose-invert prose-sm max-w-none text-gray-300">
                          <ReactMarkdown>{msg.text}</ReactMarkdown>
                        </div>
                      )}
                      
                      {/* Generated Image */}
                      {msg.image && (
                        <div className="mt-4 rounded-xl overflow-hidden border border-lux-gray max-w-sm shadow-2xl">
                          <img src={msg.image} alt="Try On Result" className="w-full h-auto" />
                          <div className="bg-lux-dark p-3 flex justify-between items-center">
                             <span className="text-xs text-lux-gold uppercase tracking-wider">Virtual Try-On</span>
                             <button className="text-xs text-white hover:underline">Download</button>
                          </div>
                        </div>
                      )}

                      {/* Product Recommendations */}
                      {msg.products && msg.products.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4 w-full">
                          {msg.products.map((product, idx) => (
                            <ProductCard 
                              key={`${msg.id}-prod-${idx}`} 
                              product={product} 
                              onTryOn={handleTryOn}
                              isGenerating={msg.isStreaming || false}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {msg.role === 'user' && (
                   <div className="bg-white text-black px-6 py-3 rounded-2xl rounded-tr-sm max-w-lg shadow-lg">
                     <p className="text-sm font-medium">{msg.text}</p>
                   </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-lux-dark/50 border-t border-lux-gray">
          <div className="max-w-4xl mx-auto relative">
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              placeholder="Ask about trends, prices, or styling advice..."
              disabled={isLoading}
              className="w-full bg-black border border-lux-gray text-white pl-6 pr-14 py-4 rounded-full focus:border-lux-gold focus:ring-1 focus:ring-lux-gold focus:outline-none transition-all shadow-inner"
            />
            <button 
              onClick={handleSendMessage}
              disabled={!inputText.trim() || isLoading}
              className="absolute right-2 top-2 p-2 bg-lux-gold rounded-full text-black hover:bg-white transition-colors disabled:opacity-50 disabled:cursor-default"
            >
              {isLoading ? <Sparkles className="animate-spin w-5 h-5" /> : <Send className="w-5 h-5 ml-0.5" />}
            </button>
          </div>
          <p className="text-center text-xs text-gray-600 mt-2">
            Lumière uses Gemini 2.5 models. Upload a photo for try-on features.
          </p>
        </div>
      </div>

      {/* Voice Mode Overlay */}
      <VoiceMode 
        isOpen={isVoiceModeOpen} 
        onClose={() => setIsVoiceModeOpen(false)} 
        location={location}
        onProductsFound={handleVoiceProducts}
      />
    </div>
  );
}

export default App;