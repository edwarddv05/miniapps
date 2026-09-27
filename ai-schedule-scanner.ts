import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { SCHEDULE_COLORS, type DayIndex, type ScheduleColor, type ScheduleEntry } from './schedule-data';

export const GEMINI_API_KEY_STORAGE = '@miniapps/gemini_api_key';

export type ScannedImage = {
  base64: string;
  mimeType?: string;
};

export async function getGeminiApiKey(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(GEMINI_API_KEY_STORAGE)) ?? '';
  } catch {
    return '';
  }
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await AsyncStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim());
}

function normalizeTime(timeStr: string): string {
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '08:00';
  const hours = match[1].padStart(2, '0');
  const minutes = match[2];
  return `${hours}:${minutes}`;
}

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
4. Si la misma materia tiene bloques consecutivos en el mismo día (por ejemplo de 18:00 a 20:00 Teoría y de 20:00 a 22:00 Práctica), puedes consolidarlo en un solo bloque "18:00" a "22:00" con el aula respectiva.
5. Usa siempre "color": "blue"; la app asigna los colores por curso.
6. Devuelve ÚNICAMENTE un JSON válido (sin backticks de markdown, sin texto adicional) con este esquema exacto:
[
  {
    "title": "Investigación de Operaciones II",
    "day": 0,
    "start": "16:00",
    "end": "18:00",
    "location": "S4-216",
    "color": "blue"
  }
]
`;

async function resolveSupportedModels(apiKey: string): Promise<string[]> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      }
    });

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

export async function scanScheduleFromImages(
  images: ScannedImage[],
  apiKey: string
): Promise<ScheduleEntry[]> {
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(cleanKey)}`;
      let response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': cleanKey,
        },
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
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': cleanKey,
          },
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

      // Clean markdown fencing and extract JSON array
      let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const firstBracket = cleaned.indexOf('[');
      const lastBracket = cleaned.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        cleaned = cleaned.slice(firstBracket, lastBracket + 1);
      }
      const parsedEntries = JSON.parse(cleaned);

      if (!Array.isArray(parsedEntries)) {
        throw new Error('La respuesta no tiene el formato de lista esperado.');
      }

      // One colour per course, so repeated sessions of a subject match and
      // different subjects stay apart.
      const courseColors = new Map<string, ScheduleColor>();
      const colorFor = (title: string) => {
        const key = title.toLocaleLowerCase('es');
        if (!courseColors.has(key)) courseColors.set(key, SCHEDULE_COLORS[courseColors.size % SCHEDULE_COLORS.length]);
        return courseColors.get(key) as ScheduleColor;
      };
      const results: ScheduleEntry[] = [];

      for (let i = 0; i < parsedEntries.length; i++) {
        const item = parsedEntries[i];
        if (!item || typeof item !== 'object') continue;
        const title = String(item.title || '').trim();
        if (!title) continue;

        let day = Number(item.day);
        if (isNaN(day) || day < 0 || day > 6) day = 0;

        const start = normalizeTime(String(item.start || '08:00'));
        const end = normalizeTime(String(item.end || '10:00'));
        // A block that does not end after it starts would make the stored
        // schedule fail validation on the next launch.
        if (end <= start) continue;
        const location = item.location ? String(item.location).trim() : '';
        const color = colorFor(title);

        results.push({
          id: `scanned-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          day: day as DayIndex,
          start,
          end,
          location,
          color
        });
      }

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

export async function pickImagesAndScan(apiKey: string): Promise<ScheduleEntry[] | null> {
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
