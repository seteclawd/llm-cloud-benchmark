# ⚡ LLM Cloud Benchmark

Real-time benchmark dashboard for testing LLM models via the Ollama Cloud API.

## Features

- Test 25+ models through Ollama Cloud
- Measures TTFB (Time To First Byte), tokens/sec, total time
- Quick-test buttons for popular models (KIMI, GLM-5.1)
- Persistent results in localStorage
- Dark theme, mobile responsive

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your API keys
npm start
```

Open `http://localhost:8960` in your browser.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OLLAMA_API_KEY` | Yes | Your Ollama Cloud API key |
| `OPENAI_API_KEY` | No | For testing OpenAI models |
| `ANTHROPIC_API_KEY` | No | For testing Anthropic models |

## Adding Models

Edit the `MODELS` array in both `server.js` and `public/index.html` to add/remove models.

## License

MIT