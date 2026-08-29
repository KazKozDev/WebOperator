/**
 * Semantic Vector Router for skills and intent classification.
 * Uses subword N-gram TF-IDF vector space embeddings with cosine similarity.
 * Runs instantly (<1ms) inside Chrome Extension Service Worker without heavy dependencies.
 */

export interface SemanticDocument {
  id: string;
  text: string;
}

export interface SemanticMatch {
  id: string;
  score: number;
  matchedTokens: string[];
}

export class SemanticRouter {
  private docVectors = new Map<string, { vector: Map<string, number>; magnitude: number }>();
  private idf = new Map<string, number>();

  constructor(docs: SemanticDocument[]) {
    this.index(docs);
  }

  /**
   * Tokenizes text into normalized word stems and character 3-grams for typo & stem invariance.
   */
  public tokenize(text: string): string[] {
    const normalized = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .trim();

    const words = normalized.split(/\s+/).filter((w) => w.length > 1);
    const tokens: string[] = [];

    for (const word of words) {
      tokens.push(word);
      // Generate character 3-grams for subword matching (e.g. "таблиц" -> "таб", "абл", "бли", "лиц")
      if (word.length >= 3) {
        for (let i = 0; i <= word.length - 3; i++) {
          tokens.push(`$${word.substring(i, i + 3)}`);
        }
      }
    }

    return tokens;
  }

  private index(docs: SemanticDocument[]): void {
    const numDocs = docs.length;
    const docFreq = new Map<string, number>();

    // 1. Calculate document frequencies
    for (const doc of docs) {
      const tokens = new Set(this.tokenize(doc.text));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    // 2. Calculate Inverse Document Frequency (IDF)
    for (const [token, freq] of docFreq.entries()) {
      this.idf.set(token, Math.log((numDocs + 1) / (freq + 1)) + 1);
    }

    // 3. Build TF-IDF document vectors and magnitudes
    for (const doc of docs) {
      const tokens = this.tokenize(doc.text);
      const tf = new Map<string, number>();
      for (const token of tokens) {
        tf.set(token, (tf.get(token) ?? 0) + 1);
      }

      const vector = new Map<string, number>();
      let sumSq = 0;

      for (const [token, count] of tf.entries()) {
        const idfWeight = this.idf.get(token) ?? 1;
        const weight = (count / tokens.length) * idfWeight;
        vector.set(token, weight);
        sumSq += weight * weight;
      }

      const magnitude = Math.sqrt(sumSq) || 1;
      this.docVectors.set(doc.id, { vector, magnitude });
    }
  }

  /**
   * Classifies query against indexed documents using Cosine Similarity.
   */
  public query(queryText: string, minScore = 0.20): SemanticMatch[] {
    const tokens = this.tokenize(queryText);
    if (tokens.length === 0) return [];

    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }

    const queryVector = new Map<string, number>();
    let sumSq = 0;

    for (const [token, count] of tf.entries()) {
      const idfWeight = this.idf.get(token) ?? 1;
      const weight = (count / tokens.length) * idfWeight;
      queryVector.set(token, weight);
      sumSq += weight * weight;
    }

    const queryMagnitude = Math.sqrt(sumSq) || 1;
    const matches: SemanticMatch[] = [];

    for (const [id, doc] of this.docVectors.entries()) {
      let dotProduct = 0;
      const matchedTokens: string[] = [];

      for (const [token, qWeight] of queryVector.entries()) {
        const dWeight = doc.vector.get(token);
        if (dWeight !== undefined) {
          dotProduct += qWeight * dWeight;
          if (!token.startsWith('$')) {
            matchedTokens.push(token);
          }
        }
      }

      const cosineSimilarity = dotProduct / (queryMagnitude * doc.magnitude);
      if (cosineSimilarity >= minScore) {
        matches.push({
          id,
          score: Math.round(cosineSimilarity * 100) / 100,
          matchedTokens: Array.from(new Set(matchedTokens)),
        });
      }
    }

    return matches.sort((a, b) => b.score - a.score);
  }
}
