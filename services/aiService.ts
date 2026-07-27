import { GoogleGenAI } from "@google/genai";
import { AIEntityData } from '../types';

export class AIService {
  private static aiClient: GoogleGenAI | null = null;

  private static getClient(): GoogleGenAI | null {
    if (this.aiClient) return this.aiClient;
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY || (window as any).__GEMINI_API_KEY__;
    if (apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey });
      return this.aiClient;
    }
    return null;
  }

  /**
   * Generates a concise AI definition/explanation for a selected phrase in context.
   */
  static async explainTerm(term: string, contextText: string, targetLang: string = 'zh'): Promise<AIEntityData> {
    const client = this.getClient();
    if (!client) {
      return {
        term,
        definition: "Gemini API key is not configured. Set VITE_GEMINI_API_KEY in .env.",
      };
    }

    const prompt = `You are a helpful reading assistant. Explain the term "${term}" in the context of: "${contextText}".
Output a JSON object with:
- "definition": A clear, concise explanation (1-2 sentences) in ${targetLang === 'zh' ? 'Simplified Chinese' : 'English'}.
- "category": Optional tag like "character", "location", "concept", "vocabulary".
Respond ONLY with raw JSON, no markdown formatting.`;

    try {
      const response = await client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const responseText = response.text || '';
      const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanJson);

      return {
        term,
        definition: parsed.definition || responseText,
        category: parsed.category,
      };
    } catch (e: any) {
      console.error("[AIService] explainTerm error:", e);
      return {
        term,
        definition: `AI Explanation failed: ${e.message || 'Network error'}`,
      };
    }
  }
}
