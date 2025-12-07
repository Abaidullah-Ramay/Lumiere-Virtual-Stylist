import React from 'react';
import { Product } from '../types';
import { Shirt, Sparkles } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  onTryOn: (product: Product) => void;
  isGenerating: boolean;
}

export const ProductCard: React.FC<ProductCardProps> = ({ product, onTryOn, isGenerating }) => {
  return (
    <div className="bg-lux-dark border border-lux-gray rounded-xl overflow-hidden hover:border-lux-gold transition-all duration-300 group flex flex-col h-full">
      <div className="p-4 flex-1">
        <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-bold tracking-widest text-lux-gold uppercase">{product.brand}</span>
            <span className="text-sm font-medium text-gray-300">{product.price}</span>
        </div>
        <h3 className="text-lg font-serif text-white mb-2 leading-tight">{product.name}</h3>
        <p className="text-sm text-gray-400 line-clamp-3">{product.description}</p>
      </div>
      
      <div className="p-4 pt-0 mt-auto">
        <button 
          onClick={() => onTryOn(product)}
          disabled={isGenerating}
          className="w-full py-2 bg-white text-black font-medium text-sm hover:bg-lux-gold hover:text-white transition-colors flex items-center justify-center gap-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isGenerating ? <Sparkles className="animate-spin w-4 h-4" /> : <Shirt className="w-4 h-4" />}
          {isGenerating ? 'Designing...' : 'Virtual Try-On'}
        </button>
      </div>
    </div>
  );
};
