import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { extractJsonArray, parseScannedClasses, type ScannedClass } from './schedule-scan';

// Earlier versions kept the key in AsyncStorage; it moves to the Keychain on first read.
const LEGACY_KEY_STORAGE = '@miniapps/gemini_api_key';
const SECURE_KEY = 'gemini_api_key';
// The web build has no Keychain.
const hasKeychain = Platform.OS !== 'web';

export type ScannedImage = {
  base64: string;
  mimeType?: string;
};

export async function getGeminiApiKey(): Promise<string> {
  try {
    if (!hasKeychain) return (await AsyncStorage.getItem(LEGACY_KEY_STORAGE)) ?? '';
    const stored = await SecureStore.getItemAsync(SECURE_KEY);
    if (stored) return stored;
    const legacy = await AsyncStorage.getItem(LEGACY_KEY_STORAGE);
    if (!legacy) return '';
    await SecureStore.setItemAsync(SECURE_KEY, legacy);
    await AsyncStorage.removeItem(LEGACY_KEY_STORAGE);
    return legacy;
  } catch {
    return '';
  }
}

export async function setGeminiApiKey(key: string): Promise<void> {
  const value = key.trim();
  if (!hasKeychain) {
    await (value ? AsyncStorage.setItem(LEGACY_KEY_STORAGE, value) : AsyncStorage.removeItem(LEGACY_KEY_STORAGE));
    return;
  }
  if (value) await SecureStore.setItemAsync(SECURE_KEY, value);
  else await SecureStore.deleteItemAsync(SECURE_KEY);
  await AsyncStorage.removeItem(LEGACY_KEY_STORAGE).catch(() => undefined);
  modelsCache = null;
}

// The key goes only in this header, never in the URL, where proxies and logs keep it.
const geminiHeaders = (apiKey: string) => ({ 'Content-Type': 'application/json', 'x-goog-api-key': apiKey });

const SYSTEM_PROMPT = `
Eres un asistente experto analizando horarios universitarios y escolares (incluyendo cuadrículas semanales de clases, boletas de matrícula oficiales de universidades como la UNI, tablas de asignaturas, etc.).

El usuario te proporciona una o varias imágenes de su horario de clases.
Tu objetivo es extraer con máxima precisión todas las clases recurrentes de la semana.

Reglas:
1. Si se proporcionan varias imágenes (por ejemplo, una cuadrícula visual y una boleta de matrícula con códigos, aulas o profesores), CRUZA inteligentemente la información: usa el nombre completo del curso, código y el aula correspondiente.
2. Días de la semana representados como números enteros:
   0: Lunes
   1: Martes
   2: Miércoles
   3: Jueves
   4: Viernes
   5: Sábado
   6: Domingo
3. Horas en formato exacto 24 horas "HH:MM" (ej. "08:00", "14:00", "18:00", "22:00").
4. Cada fila es una sesión distinta: NO combines bloques consecutivos de la misma materia. "kind" es el tipo de la sesión (columna TIPO): "T" para Teoría, "PRA" para Práctica, "LAB" para Laboratorio; usa "" si no aparece. La teoría y la práctica de un mismo curso pueden coincidir en horario.
5. Usa siempre "color": "blue"; la app asigna los colores por curso.
6. "code" es el código del curso (columna CURSO, ej. "GE703", "SI601") y "section" la sección (columna SEC, ej. "U", "V"). Si aparecen juntos como "GE703U", la última letra después de los números es la sección. Si no hay código o sección, usa "".
7. "location" es el aula (columna AULA, ej. "S4-216", "S1-129 (LAB A)").
8. "title" es el nombre completo del curso si aparece en alguna imagen; si solo hay código, usa el código como título.
9. Devuelve ÚNICAMENTE un JSON válido (sin backticks de markdown, sin texto adicional) con este esquema exacto:
[
  {
    "title": "Investigación de Operaciones II",
    "code": "SI601",
    "section": "V",
    "kind": "T",
    "day": 0,
    "start": "16:00",
    "end": "18:00",
    "location": "S4-216",
    "color": "blue"
  }
]
`;

// The model list is asked once per key and session.
let modelsCache: { apiKey: string; models: string[] } | null = null;

async function resolveSupportedModels(apiKey: string): Promise<string[]> {
  if (modelsCache?.apiKey === apiKey) return modelsCache.models;
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', { headers: geminiHeaders(apiKey) });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.models)) {
        const supported = data.models
          .filter((m: { name?: string; supportedGenerationMethods?: string[] }) =>
            Boolean(m?.name) &&
            Array.isArray(m?.supportedGenerationMethods) &&
            m.supportedGenerationMethods.includes('generateContent')
          )
          .map((m: { name: string }) => m.name.replace(/^models\//, ''));

        // Rank models: flash first, then pro, then any other
        const flashModels = supported.filter((id: string) => id.toLowerCase().includes('flash'));
        const otherModels = supported.filter((id: string) => !id.toLowerCase().includes('flash'));

        const candidates = [...flashModels, ...otherModels];
        if (candidates.length > 0) {
          modelsCache = { apiKey, models: candidates };
          return candidates;
        }
      }
    }
  } catch {}

  // Fallback defaults if list endpoint is unreachable
  return [
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro',
    'gemini-pro'
  ];
}

function geminiErrorMessage(status: number, body: string) {
  try {
    const message = JSON.parse(body)?.error?.message;
    if (message) return String(message);
  } catch {}
  return `Error HTTP ${status}`;
}

// Models in the list that only produce audio, images or live sessions reject
// a plain text request with 400.
const NON_TEXT_MODEL = /tts|image|audio|live|native|embed|veo|imagen|robotics|computer-use/i;
const PREFERRED_TEXT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];

// Plain text generation, tried on each available model in turn.
export async function generateGeminiText(prompt: string, apiKey: string): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) throw new Error('Debes configurar una clave de API de Gemini válida.');
  const available = (await resolveSupportedModels(cleanKey)).filter((model) => !NON_TEXT_MODEL.test(model));
  const models = [...PREFERRED_TEXT_MODELS.filter((model) => available.includes(model)), ...available.filter((model) => !PREFERRED_TEXT_MODELS.includes(model))];
  let lastError: Error | null = null;
  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: geminiHeaders(cleanKey),
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
      });
      if (!response.ok) {
        const error = new Error(geminiErrorMessage(response.status, await response.text()));
        // A rejected key fails the same way on every model; any other error may be the model's own.
        if (response.status === 401 || response.status === 403 || /api key/i.test(error.message)) throw Object.assign(error, { fatal: true });
        throw error;
      }
      const data = await response.json();
      const text = (data?.candidates?.[0]?.content?.parts ?? []).map((part: { text?: string }) => part.text ?? '').join('').trim();
      if (!text) throw new Error('El servicio no devolvió contenido.');
      return text;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if ((lastError as { fatal?: boolean }).fatal) break;
    }
  }
  throw lastError ?? new Error('No se pudo generar la respuesta.');
}

export async function scanScheduleFromImages(
  images: ScannedImage[],
  apiKey: string
): Promise<ScannedClass[]> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Debes configurar una clave de API de Gemini válida.');
  }

  if (!images.length) {
    throw new Error('No se seleccionó ninguna imagen para escanear.');
  }

  const parts: Array<Record<string, unknown>> = [
    { text: SYSTEM_PROMPT },
    { text: 'A continuación están las imágenes del horario para procesar:' }
  ];

  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: img.mimeType || 'image/jpeg',
        data: img.base64
      }
    });
  }

  const models = await resolveSupportedModels(cleanKey);
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      let response = await fetch(url, {
        method: 'POST',
        headers: geminiHeaders(cleanKey),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });

      if (!response.ok && response.status === 400) {
        // Fallback without responseMimeType in case model doesn't support json mode
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: geminiHeaders(cleanKey),
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              temperature: 0.1
            }
          })
        });
        if (retryRes.ok) {
          response = retryRes;
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        let errorMsg = `Error HTTP ${response.status}`;
        try {
          const parsed = JSON.parse(errorText);
          if (parsed.error?.message) {
            errorMsg = parsed.error.message;
          }
        } catch {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error('El servicio no devolvió contenido.');
      }

      const stamp = Date.now();
      const results = parseScannedClasses(extractJsonArray(rawText), (index) => `scanned-${stamp}-${index}-${Math.random().toString(36).slice(2, 6)}`);

      if (!results.length) {
        throw new Error('No se detectaron clases en las imágenes proporcionadas.');
      }

      return results;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Try next model if first failed
    }
  }

  throw lastError ?? new Error('No se pudo procesar el horario.');
}

export async function pickImagesAndScan(apiKey: string): Promise<ScannedClass[] | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new Error('Se requiere permiso para acceder a tus fotos y seleccionar los horarios.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    base64: true,
    quality: 0.85,
  });

  if (result.canceled || !result.assets || !result.assets.length) {
    return null;
  }

  const images: ScannedImage[] = [];
  for (const asset of result.assets) {
    let base64 = asset.base64;
    if (!base64 && asset.uri) {
      base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64',
      });
    }
    if (base64) {
      images.push({
        base64,
        mimeType: asset.mimeType || 'image/jpeg',
      });
    }
  }

  if (!images.length) {
    throw new Error('No se pudo leer la información de las imágenes seleccionadas.');
  }

  return await scanScheduleFromImages(images, apiKey);
}
