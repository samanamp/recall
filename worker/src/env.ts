import type { GitHubEnv } from "./github";

/** Minimal shape of the Workers AI binding we use (model-agnostic). */
export interface WorkersAI {
  run(
    model: string,
    options: Record<string, unknown>
  ): Promise<{ response?: string } | string>;
}

export type Env = GitHubEnv & {
  DB: D1Database;
  APP_TOKEN?: string;
  AI: WorkersAI;
  AI_MODEL?: string;
  /** Extra CORS origins, comma-separated (e.g. a separately hosted app). */
  ALLOWED_ORIGINS?: string;
};
