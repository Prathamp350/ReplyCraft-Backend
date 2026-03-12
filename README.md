# ReplyCraft AI - Backend

## Project Structure
```
backend/
├── server.js
├── package.json
├── .env
├── config/
│   └── config.js
├── controllers/
│   └── reply.controller.js
├── routes/
│   └── reply.routes.js
├── services/
│   ├── ollama.service.js
│   └── prompt.service.js
```

## Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Start Ollama
Make sure Ollama is running with mistral or phi3 model installed:
```bash
ollama serve
# In another terminal:
ollama pull mistral
ollama pull phi3
```

### 3. Start the Backend
```bash
npm start
```

The server will start on **http://localhost:3000**

## API Endpoint

### POST /api/generate-reply

**Request:**
```json
{
  "review": "Food was good but service slow",
  "tone": "professional",
  "model": "mistral"
}
```

**Parameters:**
- `review` (required): Customer review text
- `tone` (optional): "professional" | "friendly" | "apologetic" (default: "professional")
- `model` (optional): "mistral" | "phi3" (default: "mistral")

**Response:**
```json
{
  "success": true,
  "reply": "Thank you for your feedback! We're glad to hear you enjoyed our food and we're working on improving our service speed.",
  "model": "mistral"
}
```

## Testing

```bash
curl -X POST http://localhost:3000/api/generate-reply \
  -H "Content-Type: application/json" \
  -d '{"review": "Food was good but service slow", "tone": "professional", "model": "mistral"}'
```

## Health Check

```bash
curl http://localhost:3000/health
```
