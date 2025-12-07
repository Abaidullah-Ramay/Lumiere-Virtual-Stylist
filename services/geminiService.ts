import { GoogleGenAI, FunctionDeclaration, Type, Tool, Content, Part } from "@google/genai";
import { Product, UserLocation } from "../types";

// Helper to get API Key safely
const getApiKey = () => {
  const key = process.env.API_KEY;
  if (!key) throw new Error("API_KEY not found in environment");
  return key;
};

// --- Models ---
const TEXT_MODEL = 'gemini-2.5-flash'; 
const IMAGE_MODEL = 'gemini-2.5-flash-image'; 

// --- Tool Definitions ---

// Tool to display products in the UI
const displayProductsTool: FunctionDeclaration = {
  name: 'displayProducts',
  description: 'Display a list of recommended fashion products/outfits to the user in a grid.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      products: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            brand: { type: Type.STRING, description: "Brand name" },
            name: { type: Type.STRING, description: "Name of the item" },
            price: { type: Type.STRING, description: "Price with currency symbol" },
            description: { type: Type.STRING, description: "Short visual description for try-on generation" },
            category: { type: Type.STRING, description: "Category e.g. Dress, Jacket" },
          },
          required: ['brand', 'name', 'price', 'description']
        }
      }
    },
    required: ['products']
  }
};

const tools: Tool[] = [
  // googleSearch cannot be used with functionDeclarations, so we prioritize the UI tool.
  { functionDeclarations: [displayProductsTool] }
];

// --- Service Class ---

class StylistService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: getApiKey() });
  }

  async createChat(location: UserLocation, history: Content[] = []) {
    const systemInstructionText = `
      You are Lumière, a high-end virtual stylist assistant.
      The user is currently in ${location.city}, ${location.country}.
      
      Your goal is to:
      1. Provide fashion advice based on local trends, weather, and brand availability in ${location.city}.
      2. Provide estimated pricing for items based on your general knowledge.
      3. WHEN you find specific recommendations, ALWAYS use the 'displayProducts' tool to show them as interactive cards.
      4. Be concise, chic, and helpful.
      5. If the user asks to "try on" something, encourage them to click the "Try On" button on the product cards or describe what they want to see on their uploaded photo.
    `;

    return this.ai.chats.create({
      model: TEXT_MODEL,
      config: {
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemInstructionText }]
        },
        tools,
      },
      history
    });
  }

  // Generate a Try-On image (Image Editing)
  async generateTryOn(
    userPhotoBase64: string,
    outfitDescription: string
  ): Promise<string> {
    // We strip the data URL prefix if present to get raw base64
    const cleanBase64 = userPhotoBase64.replace(/^data:image\/\w+;base64,/, "");
    
    // Prompt engineering for better results
    const prompt = `Change the person's outfit to: ${outfitDescription}. Keep the face, body pose, and background exactly the same. High quality, photorealistic.`;

    try {
      const response = await this.ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [
            {
                role: 'user',
                parts: [
                    {
                        inlineData: {
                            mimeType: 'image/jpeg', // Assuming jpeg for simplicity, acceptable for flash-image input
                            data: cleanBase64
                        }
                    },
                    { text: prompt }
                ]
            }
        ]
      });

      // Extract image from response
      // flash-image returns inlineData in parts
      for (const candidate of response.candidates || []) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            return `data:image/png;base64,${part.inlineData.data}`;
          }
        }
      }
      throw new Error("No image generated");
    } catch (e) {
      console.error("Try-On Error:", e);
      throw e;
    }
  }
}

export const stylistService = new StylistService();
export { displayProductsTool };