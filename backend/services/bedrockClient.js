/**
 * AI Client – Powered by Anthropic Claude.
 * Drop-in replacement for the old Bedrock/Llama3 client.
 * All agents call callBedrock() — no changes needed elsewhere.
 *
 * Models (set CLAUDE_MODEL in .env):
 *   claude-haiku-4-5        – Fastest, cheapest (default)
 *   claude-sonnet-4-5       – Balanced speed & quality
 *   claude-opus-4-5         – Most capable
 */

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main function — drop-in replacement for the old callBedrock().
 * Accepts a prompt string and optional opts { max_gen_len }.
 */
async function callBedrock(prompt, opts = {}) {
  const maxTokens = opts.max_gen_len || MAX_TOKENS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[ClaudeClient] Rate limited — retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);
    }

    console.log(`[ClaudeClient] Calling ${MODEL} (attempt ${attempt + 1})`);

    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }, {
        timeout: 25000 // 25s timeout to prevent hanging requests
      });

      const text = response.content?.[0]?.text || "No response from Claude.";
      console.log(`[ClaudeClient] Response received (${text.length} chars)`);
      return text.trim();
    } catch (err) {
      const isRateLimit =
        err.status === 429 ||
        err.name === "RateLimitError" ||
        (err.message && err.message.toLowerCase().includes("rate limit"));

      if (isRateLimit && attempt < MAX_RETRIES) continue;

      console.error(`[ClaudeClient] Error: ${err.message}`);
      throw new Error(`Claude error: ${err.message}`);
    }
  }
}

module.exports = { callBedrock };
