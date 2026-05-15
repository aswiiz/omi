import os
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Omi Web AI")

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# OpenAI Configuration
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.1.0"}

# Static and Data paths for Vercel
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
HISTORY_FILE = "/tmp/history.json" # Use /tmp for transient storage in serverless

# Static files
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    session_id: str

def load_history():
    if os.path.exists(HISTORY_FILE):
        try:
            with open(HISTORY_FILE, "r") as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_history(history):
    try:
        # Note: /tmp is transient on Vercel
        with open(HISTORY_FILE, "w") as f:
            json.dump(history, f, indent=2)
    except Exception as e:
        print(f"History save skipped: {e}")

@app.get("/", response_class=HTMLResponse)
async def read_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r") as f:
            return f.read()
    return "Omi Web is running. Please access via /static/index.html if direct root fails."

@app.post("/api/chat")
async def chat(request: ChatRequest):
    try:
        # Prepare messages for OpenAI
        system_prompt = {
            "role": "system",
            "content": "You are Omi, a helpful AI assistant for a smartwatch. Keep responses concise, clear, and friendly. Use short sentences suitable for reading on a small screen or being spoken via TTS."
        }
        
        full_messages = [system_prompt] + [m.model_dump() for m in request.messages]
        
        response = client.chat.completions.create(
            model="gpt-4o-mini", # Using a more modern, cost-effective model
            messages=full_messages,
            max_tokens=150
        )
        
        ai_message = response.choices[0].message.content
        
        # Save history
        history = load_history()
        session_history = history.get(request.session_id, [])
        session_history.extend([m.model_dump() for m in request.messages])
        session_history.append({"role": "assistant", "content": ai_message})
        history[request.session_id] = session_history[-20:] # Keep last 20 messages
        save_history(history)
        
        return {"response": ai_message}
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
