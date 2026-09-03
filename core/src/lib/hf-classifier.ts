/**
 * Neural Intent Classifier using Hugging Face Transformers.js (ONNX Runtime WebAssembly).
 * Runs real Transformer embeddings (all-MiniLM-L6-v2) directly inside the browser.
 */

import { env, pipeline } from '@huggingface/transformers';
import type { SkillId } from './types';
import { BUILT_IN_SKILLS, type ClassifiedSkill } from './skills';


// Configure transformers.js for browser extension environment
env.allowLocalModels = false;
env.useBrowserCache = true;

let embeddingPipeline: unknown = null;
let isInitializing = false;
const skillEmbeddingCache = new Map<SkillId, number[]>();

/**
 * Calculates cosine similarity between two normalized vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator > 0 ? dotProduct / denominator : 0;
}

/**
 * Lazily loads the Hugging Face Transformers feature extraction pipeline.
 */
export async function getHFPipeline(): Promise<unknown> {

  if (embeddingPipeline) return embeddingPipeline;
  if (isInitializing) {
    while (isInitializing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return embeddingPipeline;
  }

  isInitializing = true;
  try {
    embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      // v3 replaced the `quantized` boolean with an explicit dtype; q8 is what `quantized: true`
      // used to select, so the downloaded weights stay the same file.
      dtype: 'q8',
    });
    return embeddingPipeline;
  } finally {
    isInitializing = false;
  }
}

/**
 * Generates normalized embedding vector for a given text.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  const extractor = (await getHFPipeline()) as (t: string, opts: unknown) => Promise<{ data: Float32Array }>;
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}


/**
 * Pre-warms neural embeddings for all built-in skills.
 */
export async function precomputeSkillEmbeddings(): Promise<void> {
  for (const skill of BUILT_IN_SKILLS) {
    if (skill.risk === 'high') continue;
    if (!skillEmbeddingCache.has(skill.id)) {
      const text = `${skill.name}. ${skill.summary}. Keywords: ${skill.keywords.join(', ')}`;
      const vec = await getEmbedding(text);
      skillEmbeddingCache.set(skill.id, vec);
    }
  }
}

/**
 * Classifies a user goal using Hugging Face Transformer embeddings.
 */
export async function classifyWithHuggingFace(goal: string, minSimilarity = 0.40): Promise<ClassifiedSkill[]> {
  try {
    const goalVector = await getEmbedding(goal);
    if (skillEmbeddingCache.size === 0) {
      await precomputeSkillEmbeddings();
    }

    const matches: ClassifiedSkill[] = [];

    for (const skill of BUILT_IN_SKILLS) {
      if (skill.risk === 'high') continue;
      const skillVector = skillEmbeddingCache.get(skill.id);
      if (!skillVector) continue;

      const score = cosineSimilarity(goalVector, skillVector);
      if (score >= minSimilarity) {
        matches.push({
          id: skill.id,
          reason: `HF Transformer (all-MiniLM-L6-v2) score: ${(score * 100).toFixed(0)}%`,
          auto: true,
          score,
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  } catch (err) {
    console.warn('[HF-Classifier] Neural inference fallback to vector router:', err);
    return [];
  }
}
