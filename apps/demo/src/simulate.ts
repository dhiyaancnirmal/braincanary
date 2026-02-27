import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import OpenAI from "openai";

const rps = Number(process.env.DEMO_RPS ?? "2");
const baseURL = process.env.BRAINCANARY_BASE_URL ?? "http://127.0.0.1:4100/v1";

const client = new OpenAI({
  apiKey: process.env.BRAINTRUST_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL
});

const questionsPath = resolve(process.cwd(), "apps/demo/src/questions.json");
const questions = JSON.parse(await readFile(questionsPath, "utf8")) as string[];

let sent = 0;
let failed = 0;

setInterval(async () => {
  const question = questions[Math.floor(Math.random() * questions.length)]!;
  try {
    await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: question }],
      metadata: {
        user_id: `demo-user-${Math.floor(Math.random() * 20)}`
      }
    });
    sent += 1;
  } catch (error) {
    failed += 1;
    console.error("request failed", error instanceof Error ? error.message : String(error));
  }
}, Math.floor(1000 / rps));

setInterval(() => {
  console.log(`[simulate] sent=${sent} failed=${failed} rps=${rps}`);
}, 5_000);
