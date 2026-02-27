import * as Braintrust from "braintrust";

export interface PromptReference {
  slug: string;
  version?: string;
}

export function parsePromptReference(ref: string): PromptReference {
  const [slug, version] = ref.split("@");
  if (!slug) {
    throw new Error(`Invalid prompt reference: ${ref}`);
  }
  return version ? { slug, version } : { slug };
}

export class PromptCache {
  private cache = new Map<string, unknown>();

  async resolve(projectName: string, reference?: string): Promise<unknown | null> {
    if (!reference) {
      return null;
    }

    const key = `${projectName}:${reference}`;
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? null;
    }

    const loadPrompt = (Braintrust as Record<string, unknown>).loadPrompt as
      | ((args: Record<string, unknown>) => Promise<unknown>)
      | undefined;

    if (!loadPrompt) {
      return null;
    }

    const { slug, version } = parsePromptReference(reference);
    const prompt = await loadPrompt({
      projectName,
      slug,
      version
    });

    this.cache.set(key, prompt);
    return prompt;
  }

  clear(): void {
    this.cache.clear();
  }
}
