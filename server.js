const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const app = express();
const PORT = 8960;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ollama Cloud API test
async function testOllamaModel(model, prompt) {
  const apiKey = process.env.OLLAMA_API_KEY || '';
  const body = JSON.stringify({
    model: model,
    messages: [{role: 'user', content: prompt}],
    stream: false
  });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let ttfb = null;
    
    const options = {
      hostname: 'ollama.com',
      port: 443,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    
    if (apiKey) {
      options.headers['Authorization'] = 'Bearer ' + apiKey;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => {
        if (!ttfb) ttfb = Date.now() - startTime;
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const totalTime = Date.now() - startTime;
          const evalCount = parsed.eval_count || parsed.message?.content?.split(' ').length * 1.3 || 0;
          const evalDuration = parsed.eval_duration / 1e9 || totalTime / 1000;
          const tokensPerSec = evalCount && evalDuration ? evalCount / evalDuration : 0;
          
          resolve({
            ttfb: ttfb,
            totalTime: totalTime,
            totalTokens: Math.round(evalCount),
            tokensPerSec: Math.round(tokensPerSec * 10) / 10,
            quality: null, // Quality needs manual rating or LLM-as-judge
            response: parsed.message?.content?.substring(0, 200),
            raw: parsed
          });
        } catch(e) {
          reject(new Error('Parse error: ' + data.substring(0, 100)));
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout 60s'));
    });
    req.write(body);
    req.end();
  });
}

// OpenAI API test
async function testOpenAIModel(model, prompt) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) throw new Error('No OpenAI API key');

  const body = JSON.stringify({
    model: model,
    messages: [{role: 'user', content: prompt}],
    max_tokens: 200
  });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let ttfb = null;

    const options = {
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => {
        if (!ttfb) ttfb = Date.now() - startTime;
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error.message);
          const totalTime = Date.now() - startTime;
          const usage = parsed.usage || {};
          const tokensPerSec = usage.completion_tokens && (totalTime / 1000) > 0 
            ? usage.completion_tokens / (totalTime / 1000) 
            : 0;
          
          resolve({
            ttfb: ttfb,
            totalTime: totalTime,
            totalTokens: usage.total_tokens || 0,
            tokensPerSec: Math.round(tokensPerSec * 10) / 10,
            quality: null,
            response: parsed.choices?.[0]?.message?.content?.substring(0, 200),
            raw: parsed
          });
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout 60s'));
    });
    req.write(body);
    req.end();
  });
}

// Anthropic API test
async function testAnthropicModel(model, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey) throw new Error('No Anthropic API key');

  const body = JSON.stringify({
    model: model,
    messages: [{role: 'user', content: prompt}],
    max_tokens: 200
  });

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let ttfb = null;

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => {
        if (!ttfb) ttfb = Date.now() - startTime;
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) throw new Error(parsed.error.message);
          const totalTime = Date.now() - startTime;
          const outputTokens = parsed.usage?.output_tokens || 0;
          const tokensPerSec = outputTokens && (totalTime / 1000) > 0 
            ? outputTokens / (totalTime / 1000) 
            : 0;
          
          resolve({
            ttfb: ttfb,
            totalTime: totalTime,
            totalTokens: (parsed.usage?.input_tokens || 0) + outputTokens,
            tokensPerSec: Math.round(tokensPerSec * 10) / 10,
            quality: null,
            response: parsed.content?.[0]?.text?.substring(0, 200),
            raw: parsed
          });
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Timeout 60s'));
    });
    req.write(body);
    req.end();
  });
}

// Route model to correct provider
async function testModelByProvider(modelId, prompt) {
  const model = MODELS.find(m => m.id === modelId);
  if (!model) throw new Error('Model not found: ' + modelId);

  switch (model.provider) {
    case 'ollama': return testOllamaModel(modelId, prompt);
    case 'openai': return testOpenAIModel(modelId, prompt);
    case 'anthropic': return testAnthropicModel(modelId, prompt);
    case 'google': throw new Error('Google API not implemented yet');
    default: throw new Error('Unknown provider: ' + model.provider);
  }
}

// API endpoint
app.post('/api/test', async (req, res) => {
  const {model, prompt} = req.body;
  const testPrompt = prompt || 'Explain the difference between TCP and UDP in 3 sentences.';
  
  try {
    const result = await testModelByProvider(model, testPrompt);
    res.json(result);
  } catch(e) {
    res.status(500).json({error: e.message, ttfb: null, tokensPerSec: 0, quality: null});
  }
});

// Get all model definitions
const MODELS = [
  {id:'glm-5.1',name:'GLM-5.1',provider:'ollama'},
  {id:'gpt-oss:120b',name:'GPT-OSS 120B',provider:'ollama'},
  {id:'gpt-oss:20b',name:'GPT-OSS 20B',provider:'ollama'},
  {id:'qwen3.5:122b',name:'Qwen 3.5 122B',provider:'ollama'},
  {id:'qwen3.5:27b',name:'Qwen 3.5 27B',provider:'ollama'},
  {id:'gemma4:31b',name:'Gemma 4 31B',provider:'ollama'},
  {id:'gemma4:26b',name:'Gemma 4 26B',provider:'ollama'},
  {id:'minimax-m2.7',name:'MiniMax M2.7',provider:'ollama'},
  {id:'devstral-small-2',name:'Devstral Small 2',provider:'ollama'},
  {id:'devstral-2',name:'Devstral 2',provider:'ollama'},
  {id:'nemotron-3-super',name:'Nemotron 3 Super',provider:'ollama'},
  {id:'kimi-k2.5',name:'Kimi K2.5',provider:'ollama'},
  {id:'glm-5',name:'GLM-5',provider:'ollama'},
  {id:'qwen3-next:80b',name:'Qwen 3-Next 80B',provider:'ollama'},
  {id:'qwen3-coder-next',name:'Qwen3 Coder Next',provider:'ollama'},
  {id:'minimax-m2.5',name:'MiniMax M2.5',provider:'ollama'},
  {id:'gemini-3-flash-preview',name:'Gemini 3 Flash',provider:'ollama'},
  {id:'deepseek-v3.2',name:'DeepSeek V3.2',provider:'ollama'},
  {id:'glm-4.7',name:'GLM-4.7',provider:'ollama'},
  {id:'nemotron-3-nano:30b',name:'Nemotron 3 Nano 30B',provider:'ollama'},
  {id:'nemotron-3-nano:4b',name:'Nemotron 3 Nano 4B',provider:'ollama'},
  {id:'rnj-1:8b',name:'RNJ-1 8B',provider:'ollama'},
  {id:'cogito-2.1',name:'Cogito 2.1',provider:'ollama'},
  {id:'ministral-3:14b',name:'Ministral 3 14B',provider:'ollama'},
  {id:'gpt-oss-safeguard:120b',name:'GPT-OSS Safeguard 120B',provider:'ollama'},

];

app.get('/api/models', (req, res) => {
  res.json(MODELS);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ LLM Benchmark running on http://localhost:${PORT}`);
});