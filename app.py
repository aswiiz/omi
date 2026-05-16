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

from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv()

app = FastAPI(title="Omi Web AI")

# MongoDB Configuration
MONGODB_URI = os.getenv("MONGODB_URI")
db_client = AsyncIOMotorClient(MONGODB_URI)
db = db_client.omi_db
memories_coll = db.memories

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

# Static and Data paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Static files
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[Message]
    session_id: str

class Memory(BaseModel):
    id: str
    transcript: str
    summary: str
    action_items: List[str]
    timestamp: str

async def load_memories():
    try:
        cursor = memories_coll.find().sort("timestamp_raw", -1).limit(50)
        memories = await cursor.to_list(length=50)
        # Convert _id to string if needed, but we use our own 'id'
        for m in memories:
            if "_id" in m: del m["_id"]
        return memories
    except Exception as e:
        print(f"Error loading memories: {e}")
        return []

async def save_memory(memory_data):
    try:
        # Add a raw timestamp for sorting
        memory_data["timestamp_raw"] = os.urandom(4).hex() # Placeholder for real sortable TS
        await memories_coll.insert_one(memory_data)
    except Exception as e:
        print(f"Error saving memory: {e}")

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
        memories = await load_memories()
        # Get last 3 summaries for context
        memory_context = ""
        if memories:
            past_summaries = [m["summary"] for m in memories[:3]]
            memory_context = "\nRecent memories:\n- " + "\n- ".join(past_summaries)

        system_prompt = {
            "role": "system",
            "content": f"You are Omi, a helpful AI assistant for a smartwatch. Keep responses concise, clear, and friendly. Use short sentences suitable for reading on a small screen or being spoken via TTS.{memory_context}"
        }
        
        full_messages = [system_prompt] + [m.model_dump() for m in request.messages]
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=full_messages,
            max_tokens=150
        )
        
        ai_message = response.choices[0].message.content
        return {"response": ai_message}
        
    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/summarize")
async def summarize(request: ChatRequest):
    try:
        transcript = "\n".join([f"{m.role}: {m.content}" for m in request.messages])
        
        prompt = f"""
        Summarize the following conversation transcript from an AI smartwatch assistant.
        Extract a brief summary (max 2 sentences) and a list of action items.
        
        Transcript:
        {transcript}
        
        Return a JSON object with:
        {{
            "summary": "the summary text",
            "action_items": ["item 1", "item 2"]
        }}
        """
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": "You are an expert at summarizing conversations and extracting tasks."},
                     {"role": "user", "content": prompt}],
            response_format={ "type": "json_object" }
        )
        
        result = json.loads(response.choices[0].message.content)
        
        new_memory = {
            "id": os.urandom(4).hex(),
            "transcript": transcript,
            "summary": result["summary"],
            "action_items": result["action_items"],
            "timestamp": "Today" # In a real app, use datetime
        }
        
        await save_memory(new_memory)
        
        return new_memory
        
    except Exception as e:
        print(f"Summarize Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/memories")
async def get_memories():
    return await load_memories()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
