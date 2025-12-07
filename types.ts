export interface UserLocation {
  city: string;
  country: string;
}

export interface UserPhoto {
  id: string;
  data: string; // Base64
  timestamp: number;
}

export interface Product {
  id: string;
  brand: string;
  name: string;
  price: string;
  description: string;
  currency?: string;
  category?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text?: string;
  image?: string; // For generated try-on images
  products?: Product[]; // For product recommendations
  isStreaming?: boolean;
}

export enum AppState {
  SETUP = 'SETUP',
  MAIN = 'MAIN',
}
