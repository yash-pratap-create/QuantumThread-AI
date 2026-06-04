/**
 * AI Client – Supports both Anthropic Claude SaaS API and AWS Bedrock Runtime.
 * Automatically falls back to AWS Bedrock if Anthropic API key is not configured.
 */

require("dotenv").config();
const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const Anthropic = require("@anthropic-ai/sdk");

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const isAnthropicEnabled = ANTHROPIC_KEY && 
  !String(ANTHROPIC_KEY).includes("placeholder") && 
  !String(ANTHROPIC_KEY).includes("your_anthropic");

const REGION = process.env.AWS_REGION || "us-east-1";
const BEDROCK_MODEL = process.env.BEDROCK_MODEL || "arn:aws:bedrock:us-east-1:857294630609:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Initialize clients
let anthropicClient;
let bedrockClient;

if (isAnthropicEnabled) {
  anthropicClient = new Anthropic({ apiKey: ANTHROPIC_KEY });
  console.log(`🤖 AI Engine: Anthropic Claude (model: ${CLAUDE_MODEL})`);
} else {
  // Use Bedrock credentials from environment (prefer BEDROCK-specific variables)
  const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const config = { region: REGION };
  if (accessKeyId && secretAccessKey) {
    config.credentials = { accessKeyId, secretAccessKey };
  }
  bedrockClient = new BedrockRuntimeClient(config);

  // Check if we are using a Bedrock API Key (either via BEDROCK_API_KEY starting with ABSK,
  // or via accessKeyId starting with 'BedrockAPIKey-')
  let abskToken = process.env.BEDROCK_API_KEY;
  if (abskToken && !abskToken.startsWith("ABSK")) {
    abskToken = null;
  }
  if (!abskToken && accessKeyId && accessKeyId.startsWith("BedrockAPIKey-") && secretAccessKey) {
    abskToken = "ABSK" + Buffer.from(`${accessKeyId}:${secretAccessKey}`).toString("base64");
  }

  if (abskToken) {
    console.log(`☁️  AI Engine: AWS Bedrock (model: ${BEDROCK_MODEL}, region: ${REGION}) using API Key`);
    bedrockClient.middlewareStack.add(
      (next, context) => async (args) => {
        delete args.request.headers["authorization"];
        delete args.request.headers["Authorization"];
        args.request.headers["Authorization"] = `Bearer ${abskToken}`;
        return next(args);
      },
      {
        step: "finalizeRequest",
        name: "bearerTokenMiddleware",
        priority: "high"
      }
    );
  } else {
    console.log(`☁️  AI Engine: AWS Bedrock (model: ${BEDROCK_MODEL}, region: ${REGION}) using IAM SigV4`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main function — drop-in replacement for callBedrock().
 * Accepts a prompt string and optional opts { max_gen_len }.
 */
async function callBedrock(prompt, opts = {}) {
  const maxTokens = opts.max_gen_len || 1024;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[AI Client] Rate limited — retry ${attempt}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);
    }

    try {
      if (isAnthropicEnabled) {
        console.log(`[ClaudeClient] Calling ${CLAUDE_MODEL} (attempt ${attempt + 1})`);
        const response = await anthropicClient.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }],
        }, {
          timeout: 25000 // 25s timeout to prevent hanging requests
        });
        const text = response.content?.[0]?.text || "No response from Claude.";
        console.log(`[ClaudeClient] Response received (${text.length} chars)`);
        return text.trim();
      } else {
        console.log(`[BedrockClient] Calling ${BEDROCK_MODEL} (attempt ${attempt + 1})`);
        const commandParams = {
          modelId: BEDROCK_MODEL,
          messages: [{ role: "user", content: [{ text: prompt }] }],
          inferenceConfig: {
            maxTokens: maxTokens,
            temperature: 0.7,
            topP: 0.9,
          },
        };
        if (BEDROCK_MODEL.toLowerCase().includes("claude")) {
          commandParams.additionalModelRequestFields = { top_k: 250 };
          commandParams.performanceConfig = { latency: "standard" };
        }
        const command = new ConverseCommand(commandParams);
        const response = await bedrockClient.send(command);
        const text = response.output?.message?.content?.[0]?.text || "No response from Bedrock.";
        console.log(`[BedrockClient] Response received (${text.length} chars)`);
        return text.trim();
      }
    } catch (err) {
      const isRateLimit =
        err.status === 429 ||
        err.name === "RateLimitError" ||
        err.name === "ThrottlingException" ||
        (err.message && err.message.toLowerCase().includes("rate limit")) ||
        (err.message && err.message.toLowerCase().includes("too many requests"));

      if (isRateLimit && attempt < MAX_RETRIES) continue;

      console.error(`[AI Client] Error: ${err.message}`);
      throw new Error(`AI client error: ${err.message}`);
    }
  }
}

module.exports = { callBedrock };
