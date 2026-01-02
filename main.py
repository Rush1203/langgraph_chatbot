from typing import TypedDict, Annotated, Optional, List
from langgraph.graph import add_messages, StateGraph, END
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, AIMessageChunk, ToolMessage
from dotenv import load_dotenv
from langchain_community.tools.tavily_search import TavilySearchResults
from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import json
from uuid import uuid4
from langgraph.checkpoint.memory import MemorySaver

load_dotenv()

# Initialize memory saver for checkpointing
memory = MemorySaver()


class State(TypedDict):
    messages: Annotated[List, add_messages]


# ---- Tools ----
search_tool = TavilySearchResults(max_results=4)
tools = [search_tool]

# ---- LLM ----
llm = ChatGroq(
    model="llama-3.3-70b-versatile",
    temperature=0.6,
)

llm_with_tools = llm.bind_tools(tools=tools)


# ---- Nodes ----
async def model(state: State):
    result = await llm_with_tools.ainvoke(state["messages"])
    return {"messages": [result]}


def tools_router(state: State):
    last_message = state["messages"][-1]

    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tool_node"
    return END


async def tool_node(state: State):
    """Handles tool calls emitted by the LLM."""
    last_message = state["messages"][-1]
    tool_messages = []

    for tool_call in last_message.tool_calls:
        tool_name = tool_call["name"]
        tool_args = tool_call.get("args", {})
        tool_id = tool_call["id"]

        if tool_name == "tavily_search_results_json":
            result = await search_tool.ainvoke(tool_args)

            tool_messages.append(
                ToolMessage(
                    content=json.dumps(result),
                    tool_call_id=tool_id,
                    name=tool_name,
                )
            )

    return {"messages": tool_messages}


# ---- Graph ----
graph_builder = StateGraph(State)
graph_builder.add_node("model", model)
graph_builder.add_node("tool_node", tool_node)
graph_builder.set_entry_point("model")
graph_builder.add_conditional_edges("model", tools_router)
graph_builder.add_edge("tool_node", "model")

graph = graph_builder.compile(checkpointer=memory)


# ---- FastAPI ----
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Type"],
)


def serialize_ai_message_chunk(chunk: AIMessageChunk) -> str:
    if isinstance(chunk, AIMessageChunk):
        return chunk.content or ""
    raise TypeError(f"Unsupported chunk type: {type(chunk)}")


async def generate_chat_responses(message: str, checkpoint_id: Optional[str] = None):
    is_new = checkpoint_id is None

    thread_id = checkpoint_id or str(uuid4())

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    events = graph.astream_events(
        {"messages": [HumanMessage(content=message)]},
        version="v2",
        config=config,
    )

    if is_new:
        yield f'data: {json.dumps({"type": "checkpoint", "checkpoint_id": thread_id})}\n\n'

    async for event in events:
        event_type = event["event"]

        if event_type == "on_chat_model_stream":
            chunk = event["data"]["chunk"]
            content = serialize_ai_message_chunk(chunk)

            yield f'data: {json.dumps({"type": "content", "content": content})}\n\n'

        elif event_type == "on_chat_model_end":
            output = event["data"]["output"]
            tool_calls = getattr(output, "tool_calls", [])

            for call in tool_calls:
                if call["name"] == "tavily_search_results_json":
                    query = call["args"].get("query", "")
                    yield f'data: {json.dumps({"type": "search_start", "query": query})}\n\n'

        elif event_type == "on_tool_end" and event["name"] == "tavily_search_results_json":
            output = event["data"]["output"]

            urls = [
                item["url"]
                for item in output
                if isinstance(item, dict) and "url" in item
            ]

            yield f'data: {json.dumps({"type": "search_results", "urls": urls})}\n\n'

    yield f'data: {json.dumps({"type": "end"})}\n\n'


@app.get("/chat_stream")
async def chat_stream(
    message: str = Query(...),
    checkpoint_id: Optional[str] = Query(None),
):
    return StreamingResponse(
        generate_chat_responses(message, checkpoint_id),
        media_type="text/event-stream",
    )
