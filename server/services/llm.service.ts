import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import path from "path";
import fs from "fs/promises";
import { DATA_DIR } from "../config";

export async function callLLM(
  provider: string,
  prompt: string,
  systemInstruction: string,
  jsonMode: boolean = false,
  imagePayload?: { base64: string; mimeType: string }
) {
  let text = "";
  console.log("Calling LLM with provider", provider);
  if (provider === "gemini") {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    let contents: any = prompt;
    if (imagePayload) {
      contents = [
        prompt,
        { inlineData: { data: imagePayload.base64, mimeType: imagePayload.mimeType } }
      ];
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: contents,
      config: {
        systemInstruction,
        responseMimeType: jsonMode ? "application/json" : "text/plain"
      }
    });
    text = response.text || "";
  } else if (provider === "lmstudio") {
    let systemContent = systemInstruction;
    if (jsonMode) {
      systemContent += "\n\nCRITICAL: You must respond with ONLY strictly valid JSON. Use double quotes for all keys and strings. Do not use trailing commas.";
    }
    const messages: any[] = [
      { role: "system", content: systemContent }
    ];
    if (imagePayload) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${imagePayload.mimeType};base64,${imagePayload.base64}` } }
        ]
      });
    } else {
      messages.push({ role: "user", content: prompt });
    }

    const apiUrl = process.env.LMSTUDIO_API_URL || "http://127.0.0.1:1234/v1/chat/completions";
    const modelName = process.env.LOCAL_MODEL_NAME || "local-model";
    
    const payload: any = {
      model: modelName,
      messages,
      temperature: 0.7
    };
    // Note: response_format is not sent for LM Studio as it only supports
    // 'json_schema' and 'text'. JSON output is enforced via system prompt instead.
    
    const response = await axios.post(apiUrl, payload);
    text = response.data.choices[0].message.content;
  }

  if (jsonMode) {
    let jsonStr = text.trim();
    // If wrapped in ```json or ```, remove those markers.
    if (jsonStr.startsWith("```json")) {
      jsonStr = jsonStr.substring(7);
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }
    } else if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.substring(3);
      if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.substring(0, jsonStr.length - 3);
      }
    }
    
    // Extract everything between the first { and the last }
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      const debugFile = path.join(DATA_DIR, `failed_json_${Date.now()}.txt`);
      try { await fs.writeFile(debugFile, text, "utf-8"); } catch (err) { }
      console.error(`Failed to parse JSON. Raw output saved to ${debugFile}`);
      throw new Error(`Invalid JSON response from LLM. Raw text saved to ${debugFile}`);
    }
  }
  return text;
}
