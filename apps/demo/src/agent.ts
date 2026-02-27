import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.BRAINTRUST_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: process.env.BRAINCANARY_BASE_URL ?? "http://127.0.0.1:4100/v1"
});

const question = process.argv.slice(2).join(" ") || "How do I reset my password?";

const response = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: question }]
});

console.log(response.choices[0]?.message?.content ?? "No response");
