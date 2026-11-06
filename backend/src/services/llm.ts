import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import OpenAI from "openai";
import type { LlmConfig } from "../types.js";

const openaiClient = (cfg: LlmConfig) =>
  new OpenAI({ ...(cfg.openaiApiKey ? { apiKey: cfg.openaiApiKey } : {}), ...(cfg.openaiBaseUrl ? { baseURL: cfg.openaiBaseUrl } : {}) });

async function completeOpenAI(cfg: LlmConfig, system: string, user: string): Promise<string> {
  const client = openaiClient(cfg);
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  let res;
  try {
    res = await client.chat.completions.create({ model: cfg.model, messages, reasoning_effort: cfg.effort });
  } catch (e) {
    // Non-reasoning models (e.g. gpt-4o) reject reasoning_effort; retry without it.
    if (!(e instanceof OpenAI.BadRequestError) || !/reasoning/i.test(e.message)) throw e;
    res = await client.chat.completions.create({ model: cfg.model, messages });
  }
  const choice = res.choices[0];
  if (choice?.message.refusal) throw new Error(`The model declined this request: ${choice.message.refusal}`);
  const text = choice?.message.content?.trim();
  if (!text) throw new Error(`Empty model response (finish_reason: ${choice?.finish_reason})`);
  return text;
}

/** Model IDs available to the configured provider, for the model picker. */
export async function listModels(cfg: LlmConfig): Promise<string[]> {
  if (cfg.provider === "openai") {
    const ids: string[] = [];
    for await (const m of openaiClient(cfg).models.list()) ids.push(m.id);
    return ids.sort();
  }
  if (cfg.provider === "anthropic") {
    const ids: string[] = [];
    for await (const m of new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {}).models.list()) ids.push(m.id);
    return ids;
  }
  return []; // Bedrock: model access is per account/region; type the model ID
}

/** Single-turn completion: system prompt + user prompt -> text. */
export async function complete(cfg: LlmConfig, system: string, user: string): Promise<string> {
  if (cfg.provider === "openai") return completeOpenAI(cfg, system, user);
  let response;
  if (cfg.provider === "bedrock") {
    // Claude on Amazon Bedrock (Mantle endpoint); credentials from the AWS default chain.
    const client = new AnthropicBedrockMantle({ awsRegion: cfg.region });
    response = await client.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      output_config: { effort: cfg.effort },
      system,
      messages: [{ role: "user", content: user }],
    });
  } else {
    const client = new Anthropic(cfg.apiKey ? { apiKey: cfg.apiKey } : {});
    // Server-side fallback: if a safety classifier declines, the API reroutes the request.
    response = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: cfg.effort },
      system,
      messages: [{ role: "user", content: user }],
    });
  }
  if (response.stop_reason === "refusal") {
    throw new Error("The model declined this request (stop_reason: refusal).");
  }
  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) throw new Error(`Empty model response (stop_reason: ${response.stop_reason})`);
  return text;
}

/** Pull a JSON object out of a model reply (tolerates ```json fences and surrounding prose). */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("No JSON object in model response");
  return JSON.parse(body.slice(start, end + 1)) as T;
}

/** Pull a SPARQL query out of a model reply. */
export function extractSparql(text: string): string {
  const fenced = text.match(/```(?:sparql)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Text embedding via Bedrock or OpenAI (used to index/search schema descriptions in S3 Vectors). */
export async function embed(cfg: LlmConfig, text: string): Promise<number[]> {
  if (cfg.embeddingProvider === "openai") {
    const res = await openaiClient(cfg).embeddings.create({ model: cfg.embeddingModel, input: text, dimensions: cfg.embeddingDimension });
    return res.data[0].embedding;
  }
  const client = new BedrockRuntimeClient({ region: cfg.region });
  const res = await client.send(
    new InvokeModelCommand({
      modelId: cfg.embeddingModel,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({ inputText: text, dimensions: cfg.embeddingDimension, normalize: true }),
    }),
  );
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { embedding: number[] };
  return parsed.embedding;
}
